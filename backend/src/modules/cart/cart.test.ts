import "dotenv/config";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import app from "../../app";
import { pool } from "../../config/db";

const tag = "zq" + Array.from({ length: 8 }, () => "abcdefghij"[Math.floor(Math.random() * 10)]).join("");
const emails = { admin: `test_${crypto.randomUUID()}@example.com`, a: `test_${crypto.randomUUID()}@example.com`, b: `test_${crypto.randomUUID()}@example.com` };
const password = "password123";
let server: Server, base: string;
const tk: Record<string, string> = {};
let n = 0;

const call = async (method: string, path: string, body?: object, token = tk.a) => {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
};
const product = async (price: number, stock: number) => {
  const sku = `${tag}-${++n}`;
  const r = await call("POST", "/products", { sku, name: `${tag} Piece ${n}`, price, stock }, tk.admin);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.data.id as string;
};
const add = (pid: string, quantity = 1, who = "a") => call("POST", "/cart/items", { productId: pid, quantity }, tk[who]);
const cart = async (who = "a") => (await call("GET", "/cart", undefined, tk[who])).body.data;
const line = (c: any, pid: string) => c.items.find((i: any) => i.productId === pid);

before(async () => {
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  for (const e of Object.values(emails)) await call("POST", "/auth/register", { firstName: "T", email: e, password }, "");
  await pool.query(`INSERT INTO user_roles (user_id, role_id) SELECT u.id, r.id FROM users u, roles r WHERE u.email = $1 AND r.name = 'ADMIN'`, [emails.admin]);
  for (const [k, e] of Object.entries(emails)) tk[k] = (await call("POST", "/auth/login", { email: e, password }, "")).body.data.accessToken;
});

after(async () => {
  await pool.query(`DELETE FROM products WHERE sku LIKE $1`, [`${tag}%`]); // cart lines cascade
  await pool.query(`DELETE FROM users WHERE email = ANY($1)`, [Object.values(emails)]); // carts cascade
  server.close();
  await pool.end();
});

test("requires auth; an empty cart is a valid cart", async () => {
  assert.equal((await call("GET", "/cart", undefined, "")).status, 401);
  assert.equal((await call("POST", "/cart/items", { productId: "1" }, "")).status, 401);
  assert.deepEqual(await cart(), { items: [], itemCount: 0, subtotal: "0.00", currency: "USD", hasIssues: false });
});

test("add / increment / set / remove / clear, with exact money", async () => {
  const A = await product(19.99, 50);
  const B = await product(10.01, 50);
  const C = await product(0.1, 50);

  assert.equal((await add(A, 2)).status, 201);
  await add(A, 1); // re-adding increments the same line
  await add(B, 1);
  await add(C, 3);
  let c = await cart();
  assert.equal(c.items.length, 3);
  assert.equal(line(c, A).quantity, 3);
  assert.equal(line(c, A).lineTotal, "59.97");
  assert.equal(line(c, C).lineTotal, "0.30"); // 0.1 x 3 is 0.30 in numeric (a float would give 0.30000000000000004)
  assert.equal(c.subtotal, "70.28"); // 59.97 + 10.01 + 0.30
  assert.equal(c.itemCount, 7);

  assert.equal((await call("PATCH", `/cart/items/${A}`, { quantity: 1 })).body.data.subtotal, "30.30"); // 19.99 + 10.01 + 0.30
  assert.equal((await call("PATCH", `/cart/items/${await product(5, 5)}`, { quantity: 1 })).status, 404); // not in the cart

  assert.equal((await call("DELETE", `/cart/items/${B}`)).body.data.items.length, 2);
  assert.equal((await call("DELETE", `/cart/items/${B}`)).status, 200); // removing twice is fine
  assert.equal((await call("DELETE", "/cart")).body.data.itemCount, 0);
});

test("validation: unknown/inactive products, stock, per-line limit", async () => {
  assert.equal((await add("999999999")).status, 404);
  assert.equal((await call("POST", "/cart/items", { productId: "abc" })).status, 400);
  assert.equal((await call("POST", "/cart/items", { productId: "1", quantity: 0 })).status, 400);
  assert.equal((await call("POST", "/cart/items", { productId: "1", quantity: 21 })).status, 400);

  const gone = await product(5, 5);
  await call("DELETE", `/products/${gone}`, undefined, tk.admin); // soft-delete
  assert.equal((await add(gone)).status, 404);

  const sold = await product(5, 0);
  const r = await add(sold);
  assert.equal(r.status, 409);
  assert.match(r.body.message, /Out of stock/);

  const few = await product(5, 3);
  assert.equal((await add(few, 2)).status, 201);
  const over = await add(few, 2); // 2 + 2 = 4 > 3 available (cumulative!)
  assert.equal(over.status, 409);
  assert.match(over.body.message, /Only 3 available/);
  assert.equal(line(await cart(), few).quantity, 2); // the failed add changed nothing

  const lots = await product(5, 100);
  assert.equal((await add(lots, 20)).status, 201);
  const cap = await add(lots, 1);
  assert.equal(cap.status, 409);
  assert.match(cap.body.message, /Limit is 20/);
  await call("DELETE", "/cart");
});

test("CONCURRENCY: parallel adds lose no updates, and a brand-new cart is created exactly once", async () => {
  const P = await product(7, 100);
  // user b has no cart yet: 10 simultaneous first requests race to create it
  const res = await Promise.all(Array.from({ length: 10 }, () => add(P, 1, "b")));
  assert.deepEqual([...new Set(res.map((r) => r.status))], [201]); // none failed, none 500
  assert.equal(line(await cart("b"), P).quantity, 10); // all ten increments landed (no lost updates)
  const carts = await pool.query(`SELECT count(*) FROM carts c JOIN users u ON u.id = c.user_id WHERE u.email = $1`, [emails.b]);
  assert.equal(carts.rows[0].count, "1"); // UNIQUE(user_id) + ON CONFLICT: exactly one cart
});

test("concurrent adds still respect stock (check + write are serialized per cart)", async () => {
  const P = await product(7, 5);
  const res = await Promise.all(Array.from({ length: 10 }, () => add(P, 1, "a")));
  assert.equal(res.filter((r) => r.status === 201).length, 5); // exactly the 5 available
  assert.equal(res.filter((r) => r.status === 409).length, 5);
  assert.equal(line(await cart("a"), P).quantity, 5);
  await call("DELETE", "/cart");
});

test("the cart follows live stock and price, and never reserves stock", async () => {
  const P = await product(40, 10);
  await add(P, 4);
  const inv = async () => (await pool.query(`SELECT reserved_quantity AS r FROM inventory WHERE product_id = $1`, [P])).rows[0].r;
  assert.equal(await inv(), 0); // adding to a cart holds nothing

  let c = await cart();
  assert.deepEqual([line(c, P).available, line(c, P).issues, c.hasIssues], [10, [], false]);

  await call("PUT", `/inventory/${P}/stock`, { quantity: 2 }, tk.admin); // stock drops under the cart
  c = await cart();
  assert.deepEqual([line(c, P).available, line(c, P).issues, c.hasIssues], [2, ["INSUFFICIENT_STOCK"], true]);

  await call("PUT", `/inventory/${P}/stock`, { quantity: 0 }, tk.admin);
  assert.deepEqual(line(await cart(), P).issues, ["OUT_OF_STOCK"]);

  await call("PATCH", `/products/${P}`, { price: 45 }, tk.admin); // live price
  assert.equal(line(await cart(), P).unitPrice, "45.00");

  await call("DELETE", `/products/${P}`, undefined, tk.admin); // deactivated: flagged, excluded from the subtotal
  c = await cart();
  assert.deepEqual(line(c, P).issues, ["UNAVAILABLE"]);
  assert.equal(c.subtotal, "0.00");
  await call("DELETE", "/cart");
});

test("guest merge: keep the larger quantity, skip the unavailable, clamp to stock, and be idempotent", async () => {
  const A = await product(10, 50), B = await product(10, 50), D = await product(10, 2), E = await product(10, 0), F = await product(10, 50);
  const dead = await product(10, 5);
  await call("DELETE", `/products/${dead}`, undefined, tk.admin);
  await add(A, 2);
  await add(F, 4);

  const guest = [
    { productId: A, quantity: 1 }, // server has 2 -> stays 2 (larger wins, no doubling)
    { productId: B, quantity: 3 }, // new line
    { productId: D, quantity: 5 }, // only 2 in stock -> clamped
    { productId: E, quantity: 1 }, // sold out -> skipped
    { productId: dead, quantity: 1 }, // inactive -> skipped
    { productId: "999999999", quantity: 1 }, // unknown -> skipped
    { productId: F, quantity: 6 }, // server has 4 -> raised to 6
    { productId: B, quantity: 1 }, // duplicate in the guest cart: larger (3) wins
  ];
  const first = (await call("POST", "/cart/merge", { items: guest })).body.data;
  const qty = (c: any, id: string) => line(c, id)?.quantity;
  assert.deepEqual([qty(first.cart, A), qty(first.cart, B), qty(first.cart, D), qty(first.cart, E), qty(first.cart, F)], [2, 3, 2, undefined, 6]);
  assert.deepEqual(first.adjusted, [{ productId: D, wanted: 5, got: 2 }]);
  assert.deepEqual(first.skipped.map((s: any) => s.reason).sort(), ["OUT_OF_STOCK", "UNAVAILABLE", "UNAVAILABLE"]);

  const again = (await call("POST", "/cart/merge", { items: guest })).body.data; // a retried request changes nothing
  assert.deepEqual(again.cart.items.map((i: any) => [i.productId, i.quantity]), first.cart.items.map((i: any) => [i.productId, i.quantity]));
  assert.equal((await call("POST", "/cart/merge", { items: [] })).status, 400);
  await call("DELETE", "/cart");
});

test("carts are private to their owner", async () => {
  const P = await product(10, 10);
  await add(P, 2, "a");
  assert.equal((await cart("b")).items.length === 0 || !line(await cart("b"), P), true);
  assert.equal(line(await cart("a"), P).quantity, 2);
});
