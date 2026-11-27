import "dotenv/config";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import Stripe from "stripe";
import app from "../../app";
import { pool } from "../../config/db";
import { setStripeClient } from "../../config/stripe";
import * as inventory from "../inventory/inventory.service";
import * as orders from "../orders/order.service";

// ---- a fake Stripe API (in memory). Signature verification below is the REAL code path, only the network is faked. ----
class FakeStripe {
  n = 0;
  intents = new Map<string, any>();
  byKey = new Map<string, any>();
  createCalls = 0;
  refunds_: { key: string; params: any }[] = [];
  refundFailures = 0;
  paymentIntents = {
    create: async (p: any, o?: any) => {
      this.createCalls++;
      if (o?.idempotencyKey && this.byKey.has(o.idempotencyKey)) return this.byKey.get(o.idempotencyKey); // Stripe replays the first response
      const id = `pi_test_${tag}_${++this.n}`;
      const pi = { id, object: "payment_intent", client_secret: `${id}_secret_x`, status: "requires_payment_method", amount: p.amount, currency: p.currency, amount_received: 0, metadata: p.metadata };
      this.intents.set(id, pi);
      if (o?.idempotencyKey) this.byKey.set(o.idempotencyKey, pi);
      return pi;
    },
    retrieve: async (id: string) => this.intents.get(id),
    cancel: async (id: string) => Object.assign(this.intents.get(id), { status: "canceled" }),
  };
  refunds = {
    create: async (params: any, o: any) => {
      this.refunds_.push({ key: o.idempotencyKey, params });
      if (this.refundFailures > 0) { this.refundFailures--; throw new Error("stripe is down"); }
      return { id: `re_test_${tag}_${this.refunds_.length}`, status: "succeeded", amount: params.amount };
    },
  };
  succeed(id: string) { Object.assign(this.intents.get(id), { status: "succeeded", amount_received: this.intents.get(id).amount }); }
}

const tag = "zq" + Array.from({ length: 8 }, () => "abcdefghij"[Math.floor(Math.random() * 10)]).join("");
const SECRET = "whsec_test_secret";
process.env.STRIPE_WEBHOOK_SECRET = SECRET;
process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_dummy";
const fake = new FakeStripe();
setStripeClient(fake);
const signer = new Stripe("sk_test_signing_only");

const emails = { admin: `test_${crypto.randomUUID()}@example.com`, a: `test_${crypto.randomUUID()}@example.com`, b: `test_${crypto.randomUUID()}@example.com` };
const password = "password123";
const addr = { fullName: "Test Buyer", line1: "12 Rue de Rivoli", city: "Paris", country: "France" };
let server: Server, base: string, n = 0, evN = 0;
const tk: Record<string, string> = {};

const call = async (method: string, path: string, body?: object, token = tk.a, headers: Record<string, string> = {}) => {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }), ...headers }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const product = async (price: number, stock: number) => {
  const r = await call("POST", "/products", { sku: `${tag}-${++n}`, name: `${tag} Piece ${n}`, price, stock }, tk.admin);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.data.id as string;
};
const stock = async (pid: string) => (await pool.query(`SELECT quantity_on_hand AS "onHand", reserved_quantity AS reserved FROM inventory WHERE product_id = $1`, [pid])).rows[0];
const ledger = async (pid: string) => (await pool.query(`SELECT type FROM inventory_transactions WHERE product_id = $1 ORDER BY id`, [pid])).rows.map((r) => r.type);
const getOrder = async (id: string, who = "a") => (await call("GET", `/orders/${id}`, undefined, tk[who])).body.data;
const adminStatus = (id: string, status: string) => call("POST", `/admin/orders/${id}/status`, { status }, tk.admin);

/** a fresh order of `qty` units of a new product, placed by user a */
async function orderOf(price: number, stockUnits: number, qty: number) {
  const pid = await product(price, stockUnits);
  assert.equal((await call("POST", "/cart/items", { productId: pid, quantity: qty })).status, 201);
  const r = await call("POST", "/checkout", { shippingAddress: addr }, tk.a, { "Idempotency-Key": `key-${crypto.randomUUID()}` });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { pid, order: r.body.data };
}
const intentOf = async (orderId: string) => {
  const r = await call("POST", `/payments/orders/${orderId}/intent`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { ...r.body.data, id: r.body.data.clientSecret.split("_secret")[0] as string };
};

// ---- webhook helpers ----
const payload = (type: string, object: object, id = `evt_${tag}_${++evN}`) => JSON.stringify({ id, object: "event", type, data: { object } });
const piObject = (id: string, extra: object = {}) => { const pi = fake.intents.get(id); return { id, object: "payment_intent", amount: pi.amount, currency: pi.currency, amount_received: pi.amount_received, status: pi.status, metadata: pi.metadata, ...extra }; };
const hook = async (body: string, header?: string) => {
  const r = await fetch(base + "/payments/webhook", { method: "POST", headers: { "content-type": "application/json", ...(header !== "" && { "stripe-signature": header ?? signer.webhooks.generateTestHeaderString({ payload: body, secret: SECRET }) }) }, body });
  return { status: r.status, body: await r.json() };
};
const paidByCard = async (price = 40, stockUnits = 10, qty = 2) => {
  const o = await orderOf(price, stockUnits, qty);
  const pi = await intentOf(o.order.id);
  fake.succeed(pi.id);
  const r = await hook(payload("payment_intent.succeeded", piObject(pi.id)));
  assert.deepEqual([r.status, r.body.result], [200, "processed"]);
  return { ...o, pi };
};

before(async () => {
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  for (const e of Object.values(emails)) await call("POST", "/auth/register", { firstName: "T", email: e, password }, "");
  await pool.query(`INSERT INTO user_roles (user_id, role_id) SELECT u.id, r.id FROM users u, roles r WHERE u.email = $1 AND r.name = 'ADMIN'`, [emails.admin]);
  for (const [k, e] of Object.entries(emails)) tk[k] = (await call("POST", "/auth/login", { email: e, password }, "")).body.data.accessToken;
});

after(async () => {
  setStripeClient(undefined);
  await pool.query(`DELETE FROM stripe_events WHERE id LIKE $1`, [`evt_${tag}%`]);
  await pool.query(`DELETE FROM orders WHERE customer_email = ANY($1)`, [Object.values(emails)]); // payments + refunds cascade
  await pool.query(`DELETE FROM products WHERE sku LIKE $1`, [`${tag}%`]);
  await pool.query(`DELETE FROM users WHERE email = ANY($1)`, [Object.values(emails)]);
  server.close();
  await pool.end();
});

test("starting a payment: owner only, amount comes from the database, one intent per order", async () => {
  const { order } = await orderOf(25, 10, 4); // $100.00, free shipping
  assert.equal((await call("POST", `/payments/orders/${order.id}/intent`, {}, "")).status, 401);
  assert.equal((await call("POST", `/payments/orders/${order.id}/intent`, {}, tk.b)).status, 404);

  const pi = await intentOf(order.id);
  assert.deepEqual([pi.amountCents, pi.currency, pi.publishableKey], [10000, "usd", "pk_test_dummy"]);
  assert.equal(fake.intents.get(pi.id).amount, 10000);
  assert.equal(fake.intents.get(pi.id).metadata.orderId, String(order.id));
  const again = await intentOf(order.id); // reopening the payment page: same intent, no second charge object
  assert.equal(again.clientSecret, pi.clientSecret);

  // five simultaneous requests on a brand-new order (double click, two tabs): Stripe-side idempotency gives one intent
  const second = await orderOf(25, 10, 1);
  const res = await Promise.all(Array.from({ length: 5 }, () => call("POST", `/payments/orders/${second.order.id}/intent`)));
  assert.deepEqual([...new Set(res.map((r) => r.status))], [200]);
  assert.equal(new Set(res.map((r) => r.body.data.clientSecret)).size, 1);
  assert.equal((await pool.query(`SELECT count(*) FROM payments WHERE order_id = $1`, [second.order.id])).rows[0].count, "1");

  await call("POST", `/orders/${order.id}/cancel`, {});
  assert.equal((await call("POST", `/payments/orders/${order.id}/intent`)).status, 409); // can't pay for a cancelled order
});

test("webhook security: unsigned, forged and tampered requests are rejected; unknown events are acknowledged", async () => {
  const body = payload("customer.created", { id: "cus_1" });
  assert.equal((await hook(body, "")).status, 400); // no signature
  assert.equal((await hook(body, signer.webhooks.generateTestHeaderString({ payload: body, secret: "whsec_someone_else" }))).status, 400); // wrong secret
  const good = signer.webhooks.generateTestHeaderString({ payload: body, secret: SECRET });
  assert.equal((await hook(body.replace("cus_1", "cus_2"), good)).status, 400); // body changed after signing
  assert.equal((await hook(body)).status, 200);
  assert.equal((await hook(payload("customer.created", { id: "cus_3" }))).body.result, "ignored");
});

test("a succeeded payment confirms the order and sells the stock", async () => {
  const { pid, order } = await paidByCard(40, 10, 2); // 80 + 9 shipping = $89.00
  const o = await getOrder(order.id);
  assert.equal(o.status, "PAID");
  assert.deepEqual(await stock(pid), { onHand: 8, reserved: 0 });
  assert.deepEqual((await ledger(pid)).slice(-2), ["RESERVE", "SALE"]);
  assert.deepEqual([o.payments[0].status, o.payments[0].amountCents, o.payments[0].appliedToOrder], ["SUCCEEDED", 8900, true]);
  assert.equal(o.history.at(-1).toStatus, "PAID");
});

test("a payment for the wrong amount is recorded for review and never applied", async () => {
  const { order } = await orderOf(40, 10, 1);
  const pi = await intentOf(order.id);
  fake.succeed(pi.id);
  fake.intents.get(pi.id).amount_received = 100; // Stripe reports $1.00 received on a $49.00 order
  const r = await hook(payload("payment_intent.succeeded", piObject(pi.id)));
  assert.equal(r.status, 200);
  const o = await getOrder(order.id);
  assert.equal(o.status, "PENDING_PAYMENT");
  assert.deepEqual([o.payments[0].status, o.payments[0].appliedToOrder], ["SUCCEEDED", false]);
  assert.match(o.payments[0].lastError, /Amount mismatch/);
  assert.deepEqual(o.payments[0].refunds, []); // no automatic action on something this strange
});

test("DUPLICATE EVENTS: the same event delivered 5 times at once is applied exactly once", async () => {
  const { pid, order } = await orderOf(40, 10, 2);
  const pi = await intentOf(order.id);
  fake.succeed(pi.id);
  const body = payload("payment_intent.succeeded", piObject(pi.id));
  const res = await Promise.all(Array.from({ length: 5 }, () => hook(body)));
  assert.deepEqual(res.map((r) => r.status), [200, 200, 200, 200, 200]); // always 2xx, so Stripe stops retrying
  assert.deepEqual(res.map((r) => r.body.result).sort(), ["duplicate", "duplicate", "duplicate", "duplicate", "processed"]);
  assert.equal((await pool.query(`SELECT count(*) FROM stripe_events WHERE id = $1`, [JSON.parse(body).id])).rows[0].count, "1"); // recorded once
  assert.equal((await ledger(pid)).filter((t) => t === "SALE").length, 1);
  assert.deepEqual(await stock(pid), { onHand: 8, reserved: 0 });

  // a DIFFERENT event id about the same payment (Stripe can resend): still no double effect, because the logic is state-based too
  const replay = await hook(payload("payment_intent.succeeded", piObject(pi.id)));
  assert.equal(replay.body.result, "processed");
  assert.equal((await ledger(pid)).filter((t) => t === "SALE").length, 1);
  assert.equal((await getOrder(order.id)).history.filter((h: any) => h.toStatus === "PAID").length, 1);
});

test("a declined card can retry on the same intent; late 'failed' events can't undo a success", async () => {
  const { order } = await orderOf(40, 10, 1);
  const pi = await intentOf(order.id);
  const failed = payload("payment_intent.payment_failed", piObject(pi.id, { last_payment_error: { message: "Your card was declined." } }));
  assert.equal((await hook(failed)).body.result, "processed");
  let o = await getOrder(order.id);
  assert.deepEqual([o.status, o.payments[0].status, o.payments[0].lastError], ["PENDING_PAYMENT", "FAILED", "Your card was declined."]);

  const calls = fake.createCalls;
  assert.equal((await intentOf(order.id)).clientSecret, pi.clientSecret); // same intent, customer just tries another card
  assert.equal(fake.createCalls, calls);

  fake.succeed(pi.id);
  await hook(payload("payment_intent.succeeded", piObject(pi.id)));
  assert.equal((await getOrder(order.id)).status, "PAID");

  await hook(failed.replace(/evt_\w+/, `evt_${tag}_late${++evN}`)); // out-of-order delivery of an old failure
  o = await getOrder(order.id);
  assert.deepEqual([o.status, o.payments[0].status], ["PAID", "SUCCEEDED"]);
});

test("LATE PAYMENT: money arrives after the order expired, so it is refunded and nothing is sold", async () => {
  const { pid, order } = await orderOf(40, 10, 2);
  const pi = await intentOf(order.id);
  await pool.query(`UPDATE orders SET payment_expires_at = now() - interval '1 minute' WHERE id = $1`, [order.id]);
  await pool.query(`UPDATE stock_reservations SET expires_at = now() - interval '1 minute' WHERE product_id = $1`, [pid]);
  await inventory.expireStale();
  await orders.expireStale();
  assert.equal((await getOrder(order.id)).status, "CANCELLED");

  fake.succeed(pi.id);
  const before = fake.refunds_.length;
  assert.equal((await hook(payload("payment_intent.succeeded", piObject(pi.id)))).status, 200);
  const o = await getOrder(order.id);
  assert.equal(o.status, "CANCELLED"); // not resurrected
  assert.deepEqual([o.payments[0].status, o.payments[0].appliedToOrder], ["SUCCEEDED", false]);
  assert.deepEqual(o.payments[0].refunds.map((r: any) => [r.reason, r.status, r.amountCents]), [["LATE_PAYMENT", "SUCCEEDED", 8900]]);
  assert.equal(o.payments[0].refundedCents, 8900);
  assert.equal(fake.refunds_.length, before + 1);
  assert.equal(fake.refunds_.at(-1)!.params.payment_intent, pi.id);
  assert.ok(!(await ledger(pid)).includes("SALE"));
  assert.deepEqual(await stock(pid), { onHand: 10, reserved: 0 });
});

test("SAVEPOINT: if only part of an order's stock hold lapsed, nothing is half-sold and the payment is refunded", async () => {
  const p1 = await product(30, 10), p2 = await product(30, 10); // p1 < p2: lines are confirmed in this order
  for (const p of [p1, p2]) assert.equal((await call("POST", "/cart/items", { productId: p, quantity: 1 })).status, 201);
  const order = (await call("POST", "/checkout", { shippingAddress: addr }, tk.a, { "Idempotency-Key": `key-${crypto.randomUUID()}` })).body.data;
  const pi = await intentOf(order.id);
  await pool.query(`UPDATE stock_reservations SET expires_at = now() - interval '1 minute' WHERE product_id = $1`, [p2]);
  await inventory.expireStale(); // only p2's hold lapses

  fake.succeed(pi.id);
  assert.equal((await hook(payload("payment_intent.succeeded", piObject(pi.id)))).status, 200);
  assert.deepEqual(await stock(p1), { onHand: 10, reserved: 1 }); // line 1 was confirmed, then rolled back to the savepoint
  assert.ok(!(await ledger(p1)).includes("SALE"));
  const o = await getOrder(order.id);
  assert.equal(o.status, "PENDING_PAYMENT");
  assert.equal(o.payments[0].refunds[0].reason, "LATE_PAYMENT");
});

test("REFUND OUTBOX: a failed Stripe call is retried later, once, with the same idempotency key", async () => {
  const { pid, order } = await paidByCard(40, 10, 2);
  fake.refundFailures = 1;
  const r = await adminStatus(order.id, "REFUNDED");
  assert.equal(r.body.data.status, "REFUNDED");
  assert.deepEqual(await stock(pid), { onHand: 10, reserved: 0 }); // stock came back in the same transaction
  let refunds = r.body.data.payments[0].refunds;
  assert.deepEqual([refunds[0].status, refunds[0].reason], ["PENDING", "ORDER_REFUND"]); // recorded even though Stripe failed
  assert.equal((await pool.query(`SELECT last_error FROM refunds WHERE order_id = $1`, [order.id])).rows[0].last_error, "stripe is down");

  assert.equal((await call("POST", "/admin/payments/reconcile", {}, tk.a)).status, 403);
  const rec = await call("POST", "/admin/payments/reconcile", {}, tk.admin);
  assert.ok(rec.body.data.refundsDone >= 1);
  refunds = (await getOrder(order.id)).payments[0].refunds;
  assert.equal(refunds[0].status, "SUCCEEDED");
  assert.equal((await getOrder(order.id)).payments[0].refundedCents, 8900);
  const keys = fake.refunds_.filter((x) => x.params.payment_intent && fake.intents.get(x.params.payment_intent)?.metadata.orderId === String(order.id)).map((x) => x.key);
  assert.equal(keys.length, 2); // failed attempt + retry...
  assert.equal(new Set(keys).size, 1); // ...with the same idempotency key: Stripe can never refund twice

  const total = fake.refunds_.length;
  await adminStatus(order.id, "REFUNDED"); // asking again changes nothing
  assert.equal(fake.refunds_.length, total);
});

test("customer cancel-and-refund pays back immediately; a manually-confirmed order has nothing to refund on Stripe", async () => {
  const card = await paidByCard(40, 10, 2);
  const r = await call("POST", `/orders/${card.order.id}/cancel`, {});
  assert.equal(r.body.data.status, "REFUNDED");
  assert.equal(r.body.data.payments[0].refunds[0].status, "SUCCEEDED"); // flushed straight away
  assert.equal(r.body.data.payments[0].refundedCents, 8900);

  const manual = await orderOf(40, 10, 1);
  await adminStatus(manual.order.id, "PAID"); // admin confirmed an off-site payment
  const before = fake.refunds_.length;
  const m = await call("POST", `/orders/${manual.order.id}/cancel`, {});
  assert.equal(m.body.data.status, "REFUNDED");
  assert.equal(fake.refunds_.length, before); // no card payment, no Stripe refund
  assert.deepEqual(m.body.data.payments, []);
});

test("LOST WEBHOOK: the browser sync endpoint and the reconciler ask Stripe and settle the payment", async () => {
  const a = await orderOf(40, 10, 1);
  const pa = await intentOf(a.order.id);
  fake.succeed(pa.id); // paid, but no webhook ever arrives
  assert.equal((await getOrder(a.order.id)).status, "PENDING_PAYMENT");
  assert.equal((await call("POST", `/payments/orders/${a.order.id}/sync`, {}, tk.b)).status, 404);
  assert.equal((await call("POST", `/payments/orders/${a.order.id}/sync`)).body.data.status, "PAID"); // verified with Stripe, not trusted from the browser

  const b = await orderOf(40, 10, 1);
  const pb = await intentOf(b.order.id);
  fake.succeed(pb.id);
  await pool.query(`UPDATE payments SET created_at = now() - interval '10 minutes' WHERE order_id = $1`, [b.order.id]);
  const rec = (await call("POST", "/admin/payments/reconcile", {}, tk.admin)).body.data;
  assert.ok(rec.applied >= 1);
  assert.equal((await getOrder(b.order.id)).status, "PAID");

  // abandoned: the order is cancelled while the PaymentIntent is still open -> reconcile closes it so it can't be paid later
  const c = await orderOf(40, 10, 1);
  const pc = await intentOf(c.order.id);
  await call("POST", `/orders/${c.order.id}/cancel`, {});
  await pool.query(`UPDATE payments SET created_at = now() - interval '10 minutes' WHERE order_id = $1`, [c.order.id]);
  await call("POST", "/admin/payments/reconcile", {}, tk.admin);
  assert.equal(fake.intents.get(pc.id).status, "canceled");
  assert.equal((await getOrder(c.order.id)).payments[0].status, "CANCELED");
});

test("PAYMENT SUCCEEDS BUT THE ORDER UPDATE FAILS: the webhook returns 500, nothing is half-applied, and Stripe's redelivery heals it", async () => {
  const { pid, order } = await orderOf(40, 10, 2);
  const pi = await intentOf(order.id);
  fake.succeed(pi.id);
  const body = payload("payment_intent.succeeded", piObject(pi.id));
  const header = signer.webhooks.generateTestHeaderString({ payload: body, secret: SECRET });

  // make the database fail at the exact moment the order would be marked PAID
  const realConnect = pool.connect.bind(pool);
  let armed = true;
  (pool as any).connect = async () => {
    const c: any = await realConnect();
    const q = c.query.bind(c);
    c.query = (...a: any[]) => (armed && typeof a[0] === "string" && a[0].includes("UPDATE orders SET status") ? ((armed = false), Promise.reject(new Error("simulated database failure"))) : q(...a));
    return c;
  };
  const first = await hook(body, header);
  (pool as any).connect = realConnect;

  assert.equal(first.status, 500); // 5xx = "I did not process this", so Stripe will retry
  const mid = await getOrder(order.id);
  assert.equal(mid.status, "PENDING_PAYMENT");
  assert.equal(mid.payments[0].status, "PENDING"); // the payment update rolled back with it...
  assert.deepEqual(await stock(pid), { onHand: 10, reserved: 2 }); // ...and so did the stock confirmation
  assert.equal((await pool.query(`SELECT count(*) FROM stripe_events WHERE id = $1`, [JSON.parse(body).id])).rows[0].count, "0"); // event NOT marked as handled

  const second = await hook(body, header); // Stripe redelivers the same event
  assert.deepEqual([second.status, second.body.result], [200, "processed"]);
  assert.equal((await getOrder(order.id)).status, "PAID");
  assert.deepEqual(await stock(pid), { onHand: 8, reserved: 0 });
});
