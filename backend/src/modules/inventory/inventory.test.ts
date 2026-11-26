import "dotenv/config";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import app from "../../app";
import { pool } from "../../config/db";
import { outbox } from "../../utils/mailer";
import * as inv from "./inventory.service";

const tag = "zq" + Array.from({ length: 8 }, () => "abcdefghij"[Math.floor(Math.random() * 10)]).join("");
const emails = { admin: `test_${crypto.randomUUID()}@example.com`, c1: `test_${crypto.randomUUID()}@example.com`, c2: `test_${crypto.randomUUID()}@example.com` };
const password = "password123";
let server: Server, base: string;
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};
let n = 0;

const call = async (method: string, path: string, body?: object, token = tokens.admin) => {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stockRow = async (pid: string) => (await pool.query(`SELECT quantity_on_hand AS "onHand", reserved_quantity AS reserved FROM inventory WHERE product_id = $1`, [pid])).rows[0];

// a fresh product with `stock` units
async function product(stock: number, label = "Item") {
  const sku = `${tag}-${++n}`;
  const r = await call("POST", "/products", { sku, name: `${tag} ${label} ${n}`, price: 10, stock });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { id: r.body.data.id as string, sku, name: `${tag} ${label} ${n}` };
}
const reserve = (token: string, items: { productId: string; quantity: number }[]) => call("POST", "/inventory/reservations", { items }, token);

before(async () => {
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  for (const e of Object.values(emails)) await call("POST", "/auth/register", { firstName: "T", email: e, password }, "");
  await pool.query(`INSERT INTO user_roles (user_id, role_id) SELECT u.id, r.id FROM users u, roles r WHERE u.email = $1 AND r.name = 'ADMIN'`, [emails.admin]);
  for (const [k, e] of Object.entries(emails)) {
    const l = (await call("POST", "/auth/login", { email: e, password }, "")).body.data; // admin logs in AFTER the role grant
    tokens[k] = l.accessToken;
    ids[k] = l.user.id;
  }
});

after(async () => {
  await pool.query(`DELETE FROM products WHERE sku LIKE $1`, [`${tag}%`]); // inventory, reservations and ledger cascade
  await pool.query(`DELETE FROM users WHERE email = ANY($1)`, [Object.values(emails)]);
  server.close();
  await pool.end();
});

test("permissions + validation", async () => {
  const p = await product(5);
  assert.equal((await call("GET", "/inventory", undefined, "")).status, 401);
  assert.equal((await call("GET", "/inventory", undefined, tokens.c1)).status, 403);
  assert.equal((await call("POST", `/inventory/${p.id}/adjust`, { delta: 1, type: "RESTOCK" }, tokens.c1)).status, 403);
  assert.equal((await reserve("", [{ productId: p.id, quantity: 1 }])).status, 401);

  assert.equal((await call("POST", `/inventory/${p.id}/adjust`, { delta: -1, type: "RESTOCK" })).status, 400); // restock must add
  assert.equal((await call("POST", `/inventory/${p.id}/adjust`, { delta: 1, type: "DAMAGED" })).status, 400); // damaged must remove
  assert.equal((await call("POST", `/inventory/${p.id}/adjust`, { delta: 0, type: "CORRECTION" })).status, 400);
  assert.equal((await reserve(tokens.c1, [{ productId: p.id, quantity: 0 }])).status, 400);
  assert.equal((await reserve(tokens.c1, [])).status, 400);
  assert.equal((await call("GET", "/inventory/999999999")).status, 404);
});

test("new products get an inventory row, and the public API shows stock status", async () => {
  const p = await product(3); // default threshold is 5, so 3 is "low"
  const inv1 = (await call("GET", `/inventory/${p.id}`)).body.data;
  assert.deepEqual([inv1.quantityOnHand, inv1.reserved, inv1.available, inv1.status], [3, 0, 3, "LOW_STOCK"]);

  const pub = (await call("GET", `/products/${p.id}`, undefined, "")).body.data;
  assert.equal(pub.stockStatus, "LOW_STOCK");
  assert.equal(pub.stockLeft, 3); // exact count only revealed when low

  const big = await product(100);
  const bigPub = (await call("GET", `/products/${big.id}`, undefined, "")).body.data;
  assert.equal(bigPub.stockStatus, "IN_STOCK");
  assert.equal(bigPub.stockLeft, null); // no exact count when plenty

  const none = await product(0);
  assert.equal((await call("GET", `/products/${none.id}`, undefined, "")).body.data.stockStatus, "OUT_OF_STOCK");
  const visible = (await call("GET", `/products?q=${tag}&inStock=true&limit=100`, undefined, "")).body.data.map((x: any) => x.id);
  assert.ok(visible.includes(p.id) && visible.includes(big.id) && !visible.includes(none.id));
});

test("RACE: ten buyers, one unit. A naive check-then-update oversells; the atomic reservation does not", async () => {
  // --- the bug: read availability, think, then write. Every buyer reads before anyone writes. ---
  const naive = await product(1, "Naive");
  const naiveBuy = async () => {
    const { rows } = await pool.query(`SELECT quantity_on_hand - reserved_quantity AS a, reserved_quantity AS r FROM inventory WHERE product_id = $1`, [naive.id]);
    if (rows[0].a < 1) return false;
    await sleep(40); // widen the window (in real life: network, other queries, GC pauses…)
    await pool.query(`UPDATE inventory SET reserved_quantity = $2 WHERE product_id = $1`, [naive.id, rows[0].r + 1]);
    return true;
  };
  const naiveWins = (await Promise.all(Array.from({ length: 10 }, naiveBuy))).filter(Boolean).length;
  assert.ok(naiveWins > 1, `expected the naive version to oversell, but only ${naiveWins} succeeded`);

  // --- the fix: one atomic conditional UPDATE inside the reservation ---
  const safe = await product(1, "Safe");
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => reserve(i % 2 ? tokens.c1 : tokens.c2, [{ productId: safe.id, quantity: 1 }])));
  const codes = results.map((r) => r.status).sort();
  assert.deepEqual(codes, [201, 409, 409, 409, 409, 409, 409, 409, 409, 409]); // exactly one winner
  assert.match(results.find((r) => r.status === 409)!.body.message, /Out of stock/);
  assert.deepEqual(await stockRow(safe.id), { onHand: 1, reserved: 1 });

  // --- defence in depth: even a buggy "+1" with no guard cannot oversell, the CHECK constraint refuses ---
  await assert.rejects(pool.query(`UPDATE inventory SET reserved_quantity = reserved_quantity + 1 WHERE product_id = $1`, [safe.id]), (e: any) => e.code === "23514");
  console.log(`   naive version sold the single unit ${naiveWins} times; atomic version sold it once`);
});

test("release frees stock, is idempotent, and only the owner (or an admin) may release", async () => {
  const p = await product(1);
  const r = (await reserve(tokens.c1, [{ productId: p.id, quantity: 1 }])).body.data[0];
  assert.equal((await reserve(tokens.c2, [{ productId: p.id, quantity: 1 }])).status, 409); // held by c1

  assert.equal((await call("DELETE", `/inventory/reservations/${r.id}`, undefined, tokens.c2)).status, 404); // not c2's
  const rel = await call("DELETE", `/inventory/reservations/${r.id}`, undefined, tokens.c1);
  assert.equal(rel.body.data.status, "RELEASED");
  assert.equal((await call("DELETE", `/inventory/reservations/${r.id}`, undefined, tokens.c1)).body.data.status, "RELEASED"); // twice = same
  assert.deepEqual(await stockRow(p.id), { onHand: 1, reserved: 0 }); // freed exactly once

  assert.equal((await reserve(tokens.c2, [{ productId: p.id, quantity: 1 }])).status, 201); // now c2 can have it
  assert.equal((await call("DELETE", `/inventory/reservations/999999999`, undefined, tokens.c1)).status, 404);
});

test("multi-item reservation is all-or-nothing", async () => {
  const a = await product(5, "A");
  const b = await product(0, "B");
  const r = await reserve(tokens.c1, [{ productId: a.id, quantity: 2 }, { productId: b.id, quantity: 1 }]);
  assert.equal(r.status, 409);
  assert.deepEqual(await stockRow(a.id), { onHand: 5, reserved: 0 }); // A was rolled back with the failure
  const merged = await reserve(tokens.c1, [{ productId: a.id, quantity: 1 }, { productId: a.id, quantity: 2 }]); // duplicates are merged
  assert.equal(merged.body.data.length, 1);
  assert.equal(merged.body.data[0].quantity, 3);
});

test("no deadlocks when carts lock the same products in opposite orders", async () => {
  const P = await product(50, "P");
  const Q = await product(50, "Q");
  const reqs = Array.from({ length: 20 }, (_, i) => {
    const items = [{ productId: P.id, quantity: 1 }, { productId: Q.id, quantity: 1 }];
    return reserve(i % 2 ? tokens.c1 : tokens.c2, i % 2 ? items : items.reverse()); // half ask for [P,Q], half for [Q,P]
  });
  const res = await Promise.all(reqs);
  assert.deepEqual([...new Set(res.map((r) => r.status))], [201]); // service sorts lock order: nobody deadlocks
  assert.deepEqual(await stockRow(P.id), { onHand: 50, reserved: 20 });
  assert.deepEqual(await stockRow(Q.id), { onHand: 50, reserved: 20 });
});

test("a retryable error (deadlock / serialization failure) is retried transparently", async () => {
  const { withTransaction } = await import("../../config/db");
  let attempts = 0;
  const out = await withTransaction(async () => {
    if (++attempts < 3) throw Object.assign(new Error("simulated deadlock"), { code: "40P01" });
    return "ok";
  }, { retries: 3 });
  assert.deepEqual([out, attempts], ["ok", 3]);
  attempts = 0;
  await assert.rejects(withTransaction(async () => { attempts++; throw Object.assign(new Error("boom"), { code: "23505" }); }, { retries: 3 }));
  assert.equal(attempts, 1); // non-retryable errors are not retried
});

test("admin adjustments: never below reserved; stocktake locks the row; ledger adds up", async () => {
  const p = await product(10, "Ledger");
  const r = (await reserve(tokens.c1, [{ productId: p.id, quantity: 3 }])).body.data[0];
  await inv.release(r.id, { id: ids.c1, isAdmin: false });

  assert.equal((await call("POST", `/inventory/${p.id}/adjust`, { delta: 5, type: "RESTOCK", note: "delivery" })).body.data.quantityOnHand, 15);
  assert.equal((await call("POST", `/inventory/${p.id}/adjust`, { delta: -2, type: "DAMAGED" })).body.data.quantityOnHand, 13);
  assert.equal((await call("PUT", `/inventory/${p.id}/stock`, { quantity: 9 })).body.data.quantityOnHand, 9); // stocktake -> delta -4
  assert.equal((await call("PUT", `/inventory/${p.id}/stock`, { quantity: 9 })).status, 200); // no change, no ledger row

  const h = (await call("GET", `/inventory/${p.id}/history`)).body;
  assert.deepEqual(h.data.map((t: any) => t.type), ["CORRECTION", "DAMAGED", "RESTOCK", "RELEASE", "RESERVE", "INITIAL"]); // newest first
  assert.equal(h.data.reduce((s: number, t: any) => s + t.quantityDelta, 0), 9); // ledger sums to on-hand
  assert.equal(h.data.find((t: any) => t.type === "RESERVE").reservationId, h.data.find((t: any) => t.type === "RELEASE").reservationId);
  assert.equal(h.meta.total, 6);

  // can't pull stock out from under customers
  const q = await product(5, "Held");
  await reserve(tokens.c1, [{ productId: q.id, quantity: 4 }]);
  assert.equal((await call("POST", `/inventory/${q.id}/adjust`, { delta: -3, type: "DAMAGED" })).status, 409);
  assert.equal((await call("PUT", `/inventory/${q.id}/stock`, { quantity: 3 })).status, 409);
  assert.equal((await call("POST", `/inventory/${q.id}/adjust`, { delta: -1, type: "DAMAGED" })).status, 200); // exactly down to reserved: allowed
  assert.deepEqual(await stockRow(q.id), { onHand: 4, reserved: 4 });
});

test("confirm (sale) and release racing on the same reservation: exactly one wins", async () => {
  const p = await product(3);
  const r = (await reserve(tokens.c1, [{ productId: p.id, quantity: 1 }])).body.data[0];
  const [confirmed, released] = await Promise.all([inv.confirm(r.id), inv.release(r.id, { id: ids.c1, isAdmin: false })]);
  const row = await stockRow(p.id);
  assert.equal(row.reserved, 0); // never double-released, never stuck
  assert.equal(row.onHand, released.status === "CONFIRMED" || confirmed ? 2 : 3); // sold -> 2, released -> 3
  assert.equal(await inv.confirm(r.id), false); // already resolved: second confirm is a no-op
});

test("expired reservations are swept and stock returns", async () => {
  const p = await product(3);
  const r = (await reserve(tokens.c1, [{ productId: p.id, quantity: 2 }])).body.data[0];
  assert.deepEqual(await stockRow(p.id), { onHand: 3, reserved: 2 });
  await pool.query(`UPDATE stock_reservations SET expires_at = now() - interval '1 minute' WHERE id = $1`, [r.id]);
  assert.ok((await inv.expireStale()) >= 1);
  assert.deepEqual(await stockRow(p.id), { onHand: 3, reserved: 0 });
  assert.equal((await pool.query(`SELECT status FROM stock_reservations WHERE id = $1`, [r.id])).rows[0].status, "EXPIRED");
  assert.equal(await inv.confirm(r.id), false); // too late to buy: Orders must handle this
  const h = (await call("GET", `/inventory/${p.id}/history`)).body.data;
  assert.equal(h[0].type, "EXPIRE");
  assert.equal(h[0].actorName, null); // system action
});

test("low-stock alert fires once when stock crosses the threshold, not on every sale", async () => {
  const p = await product(10, "Alert");
  const mails = () => outbox.filter((m) => m.subject === `Low stock: ${p.name}`).length;
  await reserve(tokens.c1, [{ productId: p.id, quantity: 4 }]); // 6 left: above threshold (5)
  const before = mails();
  assert.equal(before, 0);
  await reserve(tokens.c1, [{ productId: p.id, quantity: 2 }]); // 4 left: crossed
  const crossed = mails();
  assert.ok(crossed >= 1);
  await reserve(tokens.c1, [{ productId: p.id, quantity: 1 }]); // 3 left: already low, no new alert
  assert.equal(mails(), crossed);

  const low = (await call("GET", `/inventory?lowStock=true&q=${p.sku}`)).body;
  assert.equal(low.data.length, 1);
  assert.equal(low.data[0].status, "LOW_STOCK");
  assert.equal((await call("PATCH", `/inventory/${p.id}`, { lowStockThreshold: 1 })).body.data.status, "IN_STOCK"); // 3 left > threshold 1
});

test("inactive products can't be reserved; sold-out is visible in the admin list", async () => {
  const p = await product(5);
  assert.equal((await call("DELETE", `/products/${p.id}`)).status, 204);
  assert.equal((await reserve(tokens.c1, [{ productId: p.id, quantity: 1 }])).status, 404);
  const list = (await call("GET", `/inventory?q=${tag}&limit=100`)).body;
  assert.ok(list.meta.total >= 1 && list.data[0].available <= list.data.at(-1).available); // sorted by scarcity
});
