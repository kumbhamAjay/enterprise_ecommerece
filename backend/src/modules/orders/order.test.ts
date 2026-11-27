import "dotenv/config";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import app from "../../app";
import { pool } from "../../config/db";
import * as inventory from "../inventory/inventory.service";
import * as orders from "./order.service";

const tag = "zq" + Array.from({ length: 8 }, () => "abcdefghij"[Math.floor(Math.random() * 10)]).join("");
const emails = { admin: `test_${crypto.randomUUID()}@example.com`, a: `test_${crypto.randomUUID()}@example.com`, b: `test_${crypto.randomUUID()}@example.com` };
const password = "password123";
const addr = { fullName: "Test Buyer", line1: "12 Rue de Rivoli", city: "Paris", postalCode: "75001", country: "France" };
let server: Server, base: string;
const tk: Record<string, string> = {};
let n = 0;

const call = async (method: string, path: string, body?: object, token = tk.a, headers: Record<string, string> = {}) => {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }), ...headers }, body: body && JSON.stringify(body) });
  return { status: r.status, headers: r.headers, body: r.status === 204 ? null : await r.json() };
};
const key = () => `key-${crypto.randomUUID()}`;
const product = async (price: number, stock: number) => {
  const sku = `${tag}-${++n}`;
  const r = await call("POST", "/products", { sku, name: `${tag} Piece ${n}`, price, stock }, tk.admin);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.data.id as string;
};
const addToCart = async (pid: string, quantity = 1, who = "a") => assert.equal((await call("POST", "/cart/items", { productId: pid, quantity }, tk[who])).status, 201);
const place = (who = "a", k = key(), body: object = { shippingAddress: addr }) => call("POST", "/checkout", body, tk[who], { "Idempotency-Key": k });
const stock = async (pid: string) => (await pool.query(`SELECT quantity_on_hand AS "onHand", reserved_quantity AS reserved FROM inventory WHERE product_id = $1`, [pid])).rows[0];
const ledger = async (pid: string) => (await pool.query(`SELECT type FROM inventory_transactions WHERE product_id = $1 ORDER BY id`, [pid])).rows.map((r) => r.type);
const setStatus = (id: string, status: string, who = "admin") => call("POST", `/admin/orders/${id}/status`, { status }, tk[who]);
const orderCount = async (email: string) => Number((await pool.query(`SELECT count(*) FROM orders WHERE customer_email = $1`, [email])).rows[0].count);
/** a fresh product with `stock` units, `qty` of it in a's cart, checked out */
const orderOf = async (price: number, stockUnits: number, qty: number, who = "a") => {
  const pid = await product(price, stockUnits);
  await addToCart(pid, qty, who);
  const r = await place(who);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { pid, order: r.body.data };
};

before(async () => {
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  for (const e of Object.values(emails)) await call("POST", "/auth/register", { firstName: "T", email: e, password }, "");
  await pool.query(`INSERT INTO user_roles (user_id, role_id) SELECT u.id, r.id FROM users u, roles r WHERE u.email = $1 AND r.name = 'ADMIN'`, [emails.admin]);
  for (const [k, e] of Object.entries(emails)) tk[k] = (await call("POST", "/auth/login", { email: e, password }, "")).body.data.accessToken;
});

after(async () => {
  await pool.query(`DELETE FROM orders WHERE customer_email = ANY($1)`, [Object.values(emails)]);
  await pool.query(`DELETE FROM products WHERE sku LIKE $1`, [`${tag}%`]);
  await pool.query(`DELETE FROM users WHERE email = ANY($1)`, [Object.values(emails)]);
  server.close();
  await pool.end();
});

test("checkout needs auth, an Idempotency-Key, a cart and a valid address", async () => {
  assert.equal((await call("POST", "/checkout", { shippingAddress: addr }, "", { "Idempotency-Key": key() })).status, 401);
  assert.equal((await call("POST", "/checkout", { shippingAddress: addr }, tk.a)).status, 400); // no key
  assert.equal((await place("a", "short")).status, 400); // malformed key
  const empty = await place("a");
  assert.equal(empty.status, 409);
  assert.match(empty.body.message, /bag is empty/);
  await addToCart(await product(10, 5));
  assert.equal((await place("a", key(), { shippingAddress: { line1: "x" } })).status, 400);
  await call("DELETE", "/cart", undefined, tk.a);
});

test("order creation: snapshot, totals, stock held, cart emptied", async () => {
  const A = await product(30, 10);
  await addToCart(A, 2);
  const prev = (await call("GET", "/checkout/preview")).body.data;
  assert.deepEqual([prev.subtotal, prev.shipping, prev.total, prev.amountToFreeShipping], ["60.00", "9.00", "69.00", "40.00"]);

  const r = await place();
  assert.equal(r.status, 201);
  const o = r.body.data;
  assert.match(o.orderNumber, /^AT-[A-Z2-9]{8}$/);
  assert.equal(o.status, "PENDING_PAYMENT");
  assert.deepEqual([o.subtotal, o.shipping, o.tax, o.total], ["60.00", "9.00", "0.00", "69.00"]);
  assert.equal(o.customerEmail, emails.a);
  assert.deepEqual(o.billingAddress, o.shippingAddress); // billing defaults to shipping
  assert.deepEqual([o.items[0].unitPrice, o.items[0].quantity, o.items[0].lineTotal], ["30.00", 2, "60.00"]);
  assert.equal(o.history.length, 1);
  assert.ok(new Date(o.paymentExpiresAt) > new Date());
  assert.equal((await call("GET", "/cart")).body.data.itemCount, 0); // cart emptied
  assert.deepEqual(await stock(A), { onHand: 10, reserved: 2 }); // held, not yet sold

  // free shipping from $100, and a separate billing address
  const B = await product(120, 5);
  await addToCart(B, 1);
  const bill = { ...addr, fullName: "Accounts Dept", line1: "1 Billing Way" };
  const o2 = (await place("a", key(), { shippingAddress: addr, billingAddress: bill })).body.data;
  assert.deepEqual([o2.shipping, o2.total, o2.billingAddress.fullName], ["0.00", "120.00", "Accounts Dept"]);

  // price/name snapshot: later catalog edits never rewrite the order
  await call("PATCH", `/products/${A}`, { price: 99, name: `${tag} Renamed` }, tk.admin);
  const again = (await call("GET", `/orders/${o.id}`)).body.data;
  assert.deepEqual([again.items[0].unitPrice, again.total], ["30.00", "69.00"]);
  assert.match(again.items[0].name, /Piece/);
});

test("IDEMPOTENCY: retries and double-clicks create exactly one order", async () => {
  const P = await product(20, 20);
  await addToCart(P, 1);
  const k = key();
  const before = await orderCount(emails.a);

  const first = await place("a", k);
  const second = await place("a", k); // the client retried (timeout, refresh, double click)
  assert.deepEqual([first.status, second.status], [201, 200]);
  assert.equal(second.headers.get("idempotent-replay"), "true");
  assert.equal(second.body.data.id, first.body.data.id);
  assert.equal(await orderCount(emails.a), before + 1);
  assert.deepEqual(await stock(P), { onHand: 20, reserved: 1 }); // reserved once, not twice

  assert.equal((await place("a", k, { shippingAddress: { ...addr, city: "Lyon" } })).status, 422); // same key, different request: client bug
  assert.equal((await place("a", key())).status, 409); // new key, nothing left in the cart

  // the real double click: five identical requests at the same instant
  await addToCart(P, 2);
  const k2 = key();
  const res = await Promise.all(Array.from({ length: 5 }, () => place("a", k2)));
  assert.deepEqual(res.map((r) => r.status).sort(), [200, 200, 200, 200, 201]);
  assert.equal(new Set(res.map((r) => r.body.data.id)).size, 1);
  assert.deepEqual(await stock(P), { onHand: 20, reserved: 3 }); // 1 + 2: the second order was held exactly once
  assert.equal(await orderCount(emails.a), before + 2);
});

test("LAST UNIT: two buyers check out at once, exactly one wins, the loser loses nothing", async () => {
  const L = await product(50, 1);
  await addToCart(L, 1, "a"); // adding to a cart does not hold stock, so both succeed
  await addToCart(L, 1, "b");
  const [ra, rb] = await Promise.all([place("a"), place("b")]);
  assert.deepEqual([ra.status, rb.status].sort(), [201, 409]);
  const loser = ra.status === 409 ? "a" : "b";
  const lost = ra.status === 409 ? ra : rb;
  assert.match(lost.body.message, /Out of stock/);
  assert.equal(lost.body.productId, L); // tells the client which line failed
  assert.deepEqual(await stock(L), { onHand: 1, reserved: 1 });
  assert.equal((await call("GET", "/cart", undefined, tk[loser])).body.data.itemCount, 1); // loser's cart untouched
  assert.equal(await orderCount(emails[loser as "a" | "b"]) , loser === "a" ? await orderCount(emails.a) : await orderCount(emails.b));
  await call("DELETE", "/cart", undefined, tk.a); await call("DELETE", "/cart", undefined, tk.b);
});

test("ATOMIC: a failure on line 2 rolls back line 1, the cart and the idempotency key", async () => {
  const X = await product(10, 5), Y = await product(10, 5);
  await addToCart(X, 2); await addToCart(Y, 1);
  await call("PUT", `/inventory/${Y}/stock`, { quantity: 0 }, tk.admin); // Y sells out after it was added to the cart
  const k = key();
  const bad = await place("a", k);
  assert.equal(bad.status, 409);
  assert.equal(bad.body.productId, Y);
  assert.deepEqual(await stock(X), { onHand: 5, reserved: 0 }); // X's reservation was rolled back with the failure
  assert.equal((await call("GET", "/cart")).body.data.items.length, 2); // cart intact

  await call("PUT", `/inventory/${Y}/stock`, { quantity: 5 }, tk.admin);
  const retry = await place("a", k); // SAME key: the failed attempt did not consume it
  assert.equal(retry.status, 201);
  assert.equal(retry.body.data.items.length, 2);
  assert.deepEqual(await stock(X), { onHand: 5, reserved: 2 });
});

test("cancelling an unpaid order releases stock; repeating it is harmless; others can't touch it", async () => {
  const { pid, order } = await orderOf(15, 3, 2);
  assert.deepEqual(await stock(pid), { onHand: 3, reserved: 2 });
  assert.equal((await call("POST", `/orders/${order.id}/cancel`, { reason: "changed my mind" }, tk.b)).status, 404);
  assert.equal((await call("GET", `/orders/${order.id}`, undefined, tk.b)).status, 404);
  assert.equal((await call("GET", `/orders/${order.id}`, undefined, tk.admin)).status, 200);

  const c = await call("POST", `/orders/${order.id}/cancel`, { reason: "changed my mind" });
  assert.deepEqual([c.status, c.body.data.status, c.body.data.cancelReason], [200, "CANCELLED", "changed my mind"]);
  assert.deepEqual(await stock(pid), { onHand: 3, reserved: 0 });

  const all = await Promise.all(Array.from({ length: 5 }, () => call("POST", `/orders/${order.id}/cancel`, {}))); // 5 simultaneous cancels
  assert.deepEqual([...new Set(all.map((r) => r.status))], [200]);
  assert.deepEqual(await stock(pid), { onHand: 3, reserved: 0 }); // released once, never negative
  assert.equal((await call("GET", `/orders/${order.id}`)).body.data.history.length, 2);
});

test("lifecycle: paid = stock sold, then fulfilment, with guarded transitions", async () => {
  const { pid, order } = await orderOf(25, 10, 4); // $100.00: free shipping
  assert.equal(order.total, "100.00");
  assert.equal((await call("POST", `/admin/orders/${order.id}/status`, { status: "PAID" }, tk.a)).status, 403); // customers can't

  const paid = await setStatus(order.id, "PAID");
  assert.equal(paid.body.data.status, "PAID");
  assert.ok(paid.body.data.paidAt);
  assert.deepEqual(await stock(pid), { onHand: 6, reserved: 0 }); // the sale left the shelf
  assert.deepEqual((await ledger(pid)).slice(-2), ["RESERVE", "SALE"]);

  assert.equal((await setStatus(order.id, "SHIPPED")).status, 409); // can't skip PROCESSING
  for (const s of ["PROCESSING", "SHIPPED", "DELIVERED"]) assert.equal((await setStatus(order.id, s)).status, 200, s);
  assert.equal((await setStatus(order.id, "PROCESSING")).status, 409); // no going backwards
  assert.equal((await setStatus(order.id, "DELIVERED")).status, 200); // repeating the current status is a no-op

  const refunded = await setStatus(order.id, "REFUNDED"); // after delivery the goods are with the customer: no automatic restock
  assert.equal(refunded.body.data.status, "REFUNDED");
  assert.deepEqual(await stock(pid), { onHand: 6, reserved: 0 });
  const h = (await call("GET", `/orders/${order.id}`)).body.data.history.map((x: any) => x.toStatus);
  assert.deepEqual(h, ["PENDING_PAYMENT", "PAID", "PROCESSING", "SHIPPED", "DELIVERED", "REFUNDED"]);
});

test("a customer refund before fulfilment returns the stock; once it is being prepared only admins can refund", async () => {
  const { pid, order } = await orderOf(25, 10, 4);
  await setStatus(order.id, "PAID");
  assert.deepEqual(await stock(pid), { onHand: 6, reserved: 0 });
  const r = await call("POST", `/orders/${order.id}/cancel`, {});
  assert.deepEqual([r.status, r.body.data.status], [200, "REFUNDED"]); // simulated instant refund
  assert.deepEqual(await stock(pid), { onHand: 10, reserved: 0 }); // restocked
  assert.deepEqual((await ledger(pid)).slice(-3), ["RESERVE", "SALE", "RETURN"]);
  assert.equal((await call("POST", `/orders/${order.id}/cancel`, {})).status, 200); // repeat: no double restock
  assert.deepEqual(await stock(pid), { onHand: 10, reserved: 0 });

  const second = await orderOf(25, 10, 1);
  await setStatus(second.order.id, "PAID"); await setStatus(second.order.id, "PROCESSING");
  assert.equal((await call("POST", `/orders/${second.order.id}/cancel`, {})).status, 409);
});

test("RACE: payment and cancellation at the same instant leave one consistent outcome", async () => {
  const { pid, order } = await orderOf(40, 5, 2);
  const [pay, cancel] = await Promise.all([setStatus(order.id, "PAID"), call("POST", `/orders/${order.id}/cancel`, {})]);
  assert.deepEqual([pay.status, cancel.status].sort(), [200, 409]); // exactly one wins
  const final = (await call("GET", `/orders/${order.id}`)).body.data.status;
  assert.equal(final, pay.status === 200 ? "PAID" : "CANCELLED");
  assert.deepEqual(await stock(pid), final === "PAID" ? { onHand: 3, reserved: 0 } : { onHand: 5, reserved: 0 }); // stock matches the winner
});

test("unpaid orders expire with their stock hold; a late payment cannot resurrect lost stock", async () => {
  const exp = await orderOf(15, 2, 1);
  await pool.query(`UPDATE orders SET payment_expires_at = now() - interval '1 minute' WHERE id = $1`, [exp.order.id]);
  assert.ok((await orders.expireStale()) >= 1);
  const o = (await call("GET", `/orders/${exp.order.id}`)).body.data;
  assert.deepEqual([o.status, o.cancelReason], ["CANCELLED", "Payment window expired"]);
  assert.deepEqual(await stock(exp.pid), { onHand: 2, reserved: 0 });

  // the stock hold lapses first (order not yet swept) and then "payment" arrives
  const late = await orderOf(15, 2, 1);
  await pool.query(`UPDATE stock_reservations SET expires_at = now() - interval '1 minute' WHERE product_id = $1`, [late.pid]);
  await inventory.expireStale();
  const pay = await setStatus(late.order.id, "PAID");
  assert.equal(pay.status, 409);
  assert.match(pay.body.message, /hold for this order has expired/);
  assert.equal((await call("GET", `/orders/${late.order.id}`)).body.data.status, "PENDING_PAYMENT"); // nothing half-applied
  assert.ok(!(await ledger(late.pid)).includes("SALE"));
});

test("order history: own orders only, newest first, paginated, filterable; admin can search all", async () => {
  const mine = (await call("GET", "/orders?limit=100")).body;
  assert.ok(mine.meta.total >= 6);
  assert.ok(mine.data.every((o: any) => o.customerEmail === emails.a));
  const times = mine.data.map((o: any) => +new Date(o.placedAt));
  assert.deepEqual(times, [...times].sort((x, y) => y - x)); // newest first
  assert.ok(typeof mine.data[0].itemCount === "number" && Array.isArray(mine.data[0].thumbs));

  const p2 = (await call("GET", "/orders?limit=2&page=2")).body;
  assert.deepEqual([p2.meta.page, p2.meta.limit, p2.data.length], [2, 2, 2]);
  const cancelled = (await call("GET", "/orders?status=CANCELLED&limit=100")).body;
  assert.ok(cancelled.data.length >= 2 && cancelled.data.every((o: any) => o.status === "CANCELLED"));

  assert.equal((await call("GET", "/admin/orders", undefined, tk.a)).status, 403);
  const byEmail = (await call("GET", `/admin/orders?q=${emails.b}&limit=100`, undefined, tk.admin)).body;
  assert.ok(byEmail.data.every((o: any) => o.customerEmail === emails.b));
  const byNumber = (await call("GET", `/admin/orders?q=${mine.data[0].orderNumber}`, undefined, tk.admin)).body;
  assert.equal(byNumber.data[0].id, mine.data[0].id);
});
