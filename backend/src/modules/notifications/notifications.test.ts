import "dotenv/config";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import Redis from "ioredis";
import app from "../../app";
import { pool } from "../../config/db";
import { EMAIL_QUEUE, MAINTENANCE_QUEUE, closeQueues, getQueue } from "../../config/queue";
import { runCleanup } from "../../jobs/cleanup";
import { scheduleJobs } from "../../jobs/schedule";
import { runMaintenance, startWorkers } from "../../jobs/workers";
import { ProviderError, setEmailProvider, type Outgoing } from "./email.provider";
import { dispatchPending, enqueueEmail } from "./email.service";
import { render, type Template } from "./email.templates";

const tag = "zq" + Array.from({ length: 8 }, () => "abcdefghij"[Math.floor(Math.random() * 10)]).join("");
// isolate this run's queues, and make retries fast enough to test (5s -> 60ms base, still exponential)
process.env.QUEUE_PREFIX = `test:bull:${tag}`;
Object.assign(process.env, { EMAIL_BACKOFF_MS: "60", EMAIL_MAX_ATTEMPTS: "4", EMAIL_RATE_PER_SEC: "1000", EMAIL_CONCURRENCY: "5" });

// ---- fake provider: records every call, and fails on demand ----
type Step = "ok" | "transient" | "permanent";
const sent: { to: string; subject: string; key: string; at: number }[] = [];
let plan: Step[] = [];
setEmailProvider({
  name: "fake",
  async send(m: Outgoing) {
    sent.push({ to: m.to, subject: m.subject, key: m.idempotencyKey, at: Date.now() });
    const step = plan.shift() ?? "ok";
    if (step === "transient") throw new ProviderError("Resend 503: try again", false);
    if (step === "permanent") throw new ProviderError("Resend 422: invalid 'to' address", true);
    return { id: `fake_${sent.length}` };
  },
});

const emails = { admin: `test_${crypto.randomUUID()}@example.com`, user: `test_${crypto.randomUUID()}@example.com` };
const rcpt = (n: string) => `${n}_${tag}@example.com`;
const password = "password123";
let server: Server, base: string, workers: ReturnType<typeof startWorkers> | undefined, n = 0;
const tk: Record<string, string> = {};
const raw = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (cond: () => Promise<boolean> | boolean, ms = 12000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await cond()) return; await sleep(40); } throw new Error("timed out waiting"); };
const row = async (key: string) => (await pool.query(`SELECT id, status, attempts, last_error AS "lastError", provider_id AS "providerId", payload, enqueued_at AS "enqueuedAt" FROM email_log WHERE dedupe_key = $1`, [key])).rows[0];
const mode = (m: "queue" | "inline") => { process.env.EMAIL_MODE = m; };
const startW = (concurrency = 5) => { process.env.EMAIL_CONCURRENCY = String(concurrency); workers = startWorkers(); };
const stopW = async () => { await workers?.close(); workers = undefined; };

const call = async (method: string, path: string, body?: object, token = tk.admin, headers: Record<string, string> = {}) => {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }), ...headers }, body: body && JSON.stringify(body) });
  const text = await r.text();
  return { status: r.status, headers: r.headers, text, body: text.startsWith("{") ? JSON.parse(text) : null };
};
const product = async (price = 30, stock = 10) => {
  const r = await call("POST", "/products", { sku: `${tag}-${++n}`, name: `${tag} Piece ${n}`, price, stock });
  assert.equal(r.status, 201, r.text);
  return r.body.data.id as string;
};

before(async () => {
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  for (const e of Object.values(emails)) await call("POST", "/auth/register", { firstName: "T", email: e, password }, "");
  await pool.query(`INSERT INTO user_roles (user_id, role_id) SELECT u.id, r.id FROM users u, roles r WHERE u.email = $1 AND r.name = 'ADMIN'`, [emails.admin]);
  for (const [k, e] of Object.entries(emails)) tk[k] = (await call("POST", "/auth/login", { email: e, password }, "")).body.data.accessToken;
  // registration sends its verification emails in the background: wait for them to land BEFORE clearing the record
  await waitFor(async () => Number((await pool.query(`SELECT count(*) FROM email_log WHERE to_email = ANY($1) AND template = 'verify-email' AND status = 'SENT'`, [Object.values(emails)])).rows[0].count) >= 2);
  sent.length = 0;
});

after(async () => {
  await stopW();
  setEmailProvider(undefined);
  mode("inline");
  await closeQueues();
  const keys = await raw.keys(`${process.env.QUEUE_PREFIX}*`);
  if (keys.length) await raw.del(...keys);
  raw.disconnect();
  await pool.query(`DELETE FROM email_log WHERE dedupe_key LIKE $1 OR to_email LIKE $2 OR to_email = ANY($3)`, [`%${tag}%`, `%${tag}%`, Object.values(emails)]);
  await pool.query(`DELETE FROM orders WHERE customer_email = ANY($1)`, [Object.values(emails)]);
  await pool.query(`DELETE FROM products WHERE sku LIKE $1`, [`${tag}%`]);
  await pool.query(`DELETE FROM users WHERE email = ANY($1)`, [Object.values(emails)]);
  server.close();
  await pool.end();
});

test("templates: every email renders, and user-controlled text is HTML-escaped", () => {
  const order = { orderId: "7", orderNumber: "AT-ABCD2345", name: "Eve", subtotal: "60.00", shipping: "9.00", total: "69.00", items: [{ name: "Stool", quantity: 2, lineTotal: "60.00" }] };
  const samples: Record<Template, object> = {
    "verify-email": { firstName: "Eve", link: "https://shop.test/verify-email?token=abc123" },
    "password-reset": { firstName: "Eve", link: "https://shop.test/reset-password?token=abc123" },
    "order-placed": order, "order-paid": order, "order-shipped": order, "order-delivered": order, "order-cancelled": { ...order, reason: "Payment window expired" }, "order-refunded": order,
    "low-stock": { name: "Walnut Stool", sku: "WS-1", available: 2, threshold: 5 },
  };
  for (const [t, p] of Object.entries(samples)) {
    const r = render(t as Template, p as any);
    assert.ok(r.subject.length > 3 && r.html.includes("<html") && r.text.length > 20, t);
  }
  assert.match(render("verify-email", samples["verify-email"] as any).text, /token=abc123/);
  assert.equal(render("low-stock", samples["low-stock"] as any).subject, "Low stock: Walnut Stool");
  assert.match(render("order-placed", order).html, /AT-ABCD2345/);
  assert.match(render("order-placed", order).text, /Total: \$69\.00/);

  const evil = render("order-placed", { ...order, name: "<script>alert(1)</script>", items: [{ name: `<img src=x onerror=alert(1)>`, quantity: 1, lineTotal: "1.00" }] });
  assert.ok(!evil.html.includes("<script>") && !evil.html.includes("<img src=x"));
  assert.match(evil.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.throws(() => render("nope" as Template, {}));
});

test("outbox (inline mode): recording the same email twice sends once; one-time links are wiped after sending", async () => {
  mode("inline");
  const key = `order-shipped:${tag}-1`;
  const input = { template: "order-shipped" as const, to: rcpt("a"), dedupeKey: key, payload: { orderId: "1", orderNumber: "AT-X" } };
  await enqueueEmail(input);
  await enqueueEmail(input); // duplicate: same dedupe key
  assert.equal(sent.filter((s) => s.key === key).length, 1);
  const r = await row(key);
  assert.deepEqual([r.status, r.attempts, r.providerId], ["SENT", 1, "fake_1"]);

  const k2 = `verify-email:${tag}:abc`;
  await enqueueEmail({ template: "verify-email", to: rcpt("b"), dedupeKey: k2, payload: { firstName: "B", link: "https://x.test/verify-email?token=SECRET123" } });
  assert.equal(sent.filter((s) => s.key === k2).length, 1);
  assert.deepEqual((await row(k2)).payload, {}); // the token link no longer sits in the database
});

test("QUEUE: an email goes through Redis and a BullMQ worker, with the dedupe key as the provider idempotency key", async () => {
  mode("queue");
  startW();
  const key = `order-paid:${tag}-q1`;
  await enqueueEmail({ template: "order-paid", to: rcpt("q1"), dedupeKey: key, payload: { orderId: "9", orderNumber: "AT-Q1", total: "10.00", items: [] } });
  await waitFor(async () => (await row(key))?.status === "SENT");
  const call1 = sent.find((s) => s.key === key)!;
  assert.deepEqual([call1.to, call1.subject], [rcpt("q1"), "Payment received for order AT-Q1"]);
  assert.deepEqual([(await row(key)).attempts, (await row(key)).providerId?.startsWith("fake_")], [1, true]);
});

test("RETRIES: transient failures back off exponentially, then it succeeds", async () => {
  process.env.EMAIL_BACKOFF_MS = "500"; // each attempt also costs ~0.6 s of database round trips, so use a base that dwarfs that noise
  const key = `order-placed:${tag}-retry`;
  plan = ["transient", "transient", "ok"];
  const base = sent.length;
  await enqueueEmail({ template: "order-placed", to: rcpt("r"), dedupeKey: key, payload: { orderId: "2", orderNumber: "AT-R", total: "5.00", items: [] } });
  await waitFor(async () => (await row(key))?.status === "SENT");
  const times = sent.slice(base).filter((s) => s.key === key).map((s) => s.at);
  assert.equal(times.length, 3);
  const [g1, g2] = [times[1] - times[0], times[2] - times[1]];
  console.log(`   retry gaps: ${g1} ms then ${g2} ms (backoff base 500 ms, doubling: +500 then +1000 on top of ~0.6 s of work)`);
  assert.ok(g1 >= 500, `first gap ${g1}`);
  assert.ok(g2 >= 1000, `second gap ${g2}`);
  assert.ok(g2 - g1 >= 300, "the wait grew by about one base delay (500 ms), as exponential backoff does");
  assert.equal((await row(key)).attempts, 3);
  process.env.EMAIL_BACKOFF_MS = "60";
});

test("a PERMANENT failure (bad address) is not retried and lands in FAILED", async () => {
  const key = `order-placed:${tag}-perm`;
  plan = ["permanent"];
  const base = sent.length;
  await enqueueEmail({ template: "order-placed", to: "not-an-address", dedupeKey: key, payload: { orderId: "3", orderNumber: "AT-P", total: "5.00", items: [] } });
  await waitFor(async () => (await row(key))?.status === "FAILED");
  await sleep(400); // long enough for any retry to show up
  assert.equal(sent.slice(base).filter((s) => s.key === key).length, 1);
  const r = await row(key);
  assert.deepEqual([r.attempts, /422/.test(r.lastError)], [1, true]);
});

test("DEAD LETTER: when every retry fails the email is FAILED, an admin sees it and can retry it", async () => {
  const key = `order-placed:${tag}-dead`;
  plan = ["transient", "transient", "transient", "transient", "transient"];
  const base = sent.length;
  await enqueueEmail({ template: "order-placed", to: rcpt("d"), dedupeKey: key, payload: { orderId: "4", orderNumber: "AT-D", total: "5.00", items: [] } });
  await waitFor(async () => (await row(key))?.status === "FAILED");
  assert.equal(sent.slice(base).filter((s) => s.key === key).length, 4); // the whole attempt budget, no more
  assert.equal((await row(key)).attempts, 4);
  plan = [];

  assert.equal((await call("GET", "/admin/emails", undefined, tk.user)).status, 403);
  const failed = (await call("GET", "/admin/emails?status=FAILED&limit=100")).body.data;
  const mine = failed.find((e: any) => e.to === rcpt("d"));
  assert.ok(mine && /503/.test(mine.lastError));
  const stats = (await call("GET", "/admin/emails/stats")).body.data;
  assert.ok(stats.emails.FAILED >= 1 && stats.queue && stats.provider === "fake");

  assert.equal((await call("POST", `/admin/emails/${mine.id}/retry`, {})).status, 200);
  await waitFor(async () => (await row(key))?.status === "SENT");
  assert.equal((await call("POST", `/admin/emails/${mine.id}/retry`, {})).status, 404); // only FAILED emails can be retried
});

test("IDEMPOTENT CONSUMER: duplicate jobs for the same email (even simultaneous) send it once", async () => {
  const key = `order-shipped:${tag}-dup`;
  mode("inline");
  await enqueueEmail({ template: "order-shipped", to: rcpt("dup"), dedupeKey: key, payload: { orderId: "5", orderNumber: "AT-DUP" } }); // SENT already
  mode("queue");
  const id = (await row(key)).id;
  const base = sent.length;
  const q = getQueue(EMAIL_QUEUE);
  await Promise.all([1, 2, 3, 4].map((i) => q.add("send", { emailId: id }, { jobId: `dup-${tag}-${i}` }))); // four deliveries of the same job
  await sleep(1200);
  assert.equal(sent.length, base); // already SENT: all four are no-ops

  // and the concurrent case: a fresh PENDING email delivered 5 times at once is still sent ONCE (row lock)
  const k2 = `order-shipped:${tag}-dup2`;
  await pool.query(`INSERT INTO email_log (dedupe_key, template, to_email, payload, enqueued_at) VALUES ($1, 'order-shipped', $2, '{"orderId":"6","orderNumber":"AT-DUP2"}', now())`, [k2, rcpt("dup2")]);
  const id2 = (await row(k2)).id;
  await Promise.all([1, 2, 3, 4, 5].map((i) => q.add("send", { emailId: id2 }, { jobId: `dup2-${tag}-${i}` })));
  await waitFor(async () => (await row(k2))?.status === "SENT");
  await sleep(600);
  assert.equal(sent.filter((s) => s.key === k2).length, 1);
});

test("OUTBOX: if the queue is unreachable the email is still recorded, and the dispatcher delivers it later", async () => {
  mode("queue");
  const q = getQueue(EMAIL_QUEUE);
  const realAdd = q.add.bind(q);
  (q as any).add = () => Promise.reject(new Error("redis is down"));
  const key = `order-paid:${tag}-down`;
  await enqueueEmail({ template: "order-paid", to: rcpt("down"), dedupeKey: key, payload: { orderId: "8", orderNumber: "AT-DOWN", total: "1.00", items: [] } }); // must not throw
  (q as any).add = realAdd;
  let r = await row(key);
  assert.deepEqual([r.status, r.enqueuedAt], ["PENDING", null]); // safe in Postgres, not lost
  assert.equal(sent.filter((s) => s.key === key).length, 0);

  assert.ok((await dispatchPending()) >= 1); // the 30-second dispatcher job does exactly this
  await waitFor(async () => (await row(key))?.status === "SENT");

  // a job lost in flight (claimed, never processed) becomes claimable again after 2 minutes
  const k2 = `order-paid:${tag}-lost`;
  await pool.query(`INSERT INTO email_log (dedupe_key, template, to_email, payload, enqueued_at) VALUES ($1, 'order-paid', $2, '{"orderId":"8","orderNumber":"AT-LOST","total":"1.00","items":[]}', now() - interval '3 minutes')`, [k2, rcpt("lost")]);
  await dispatchPending();
  await waitFor(async () => (await row(k2))?.status === "SENT");
});

test("PRIORITY: account-security email jumps the queue ahead of low-stock noise", async () => {
  await stopW(); // nothing is consuming: let jobs pile up first
  mode("queue");
  const base = sent.length;
  const mk = (template: Template, label: string, payload: object) => enqueueEmail({ template, to: rcpt(label), dedupeKey: `${template}:${tag}-prio-${label}`, payload });
  await mk("low-stock", "low", { name: "X", sku: "X", available: 1, threshold: 5 }); // priority 5
  await mk("order-shipped", "ship", { orderId: "1", orderNumber: "AT-S" }); // priority 3
  await mk("password-reset", "reset", { link: "https://x.test/reset-password?token=zzz" }); // priority 1
  await sleep(300);
  startW(1); // one at a time, so the order is the priority order
  await waitFor(() => sent.length - base >= 3);
  assert.deepEqual(sent.slice(base, base + 3).map((s) => s.to), [rcpt("reset"), rcpt("ship"), rcpt("low")]);
});

test("business flows write their emails in the same transaction (and failed checkouts write none)", async () => {
  mode("inline");
  const rows = async (like: string) => (await pool.query(`SELECT template, to_email AS "to", status FROM email_log WHERE to_email = $1 AND dedupe_key LIKE $2 ORDER BY id`, [emails.user, like])).rows;
  const addr = { fullName: "Eve Buyer", line1: "1 Rue Test", city: "Paris", country: "France" };
  const checkout = (key: string) => call("POST", "/checkout", { shippingAddress: addr }, tk.user, { "Idempotency-Key": key });

  // a checkout that FAILS (out of stock) must leave no email behind
  const sold = await product(30, 0);
  await call("POST", "/cart/items", { productId: sold, quantity: 1 }, tk.user);
  assert.equal((await checkout(`key-${crypto.randomUUID()}`)).status, 409);
  assert.equal((await rows("order-placed:%")).length, 0);
  await call("DELETE", "/cart", undefined, tk.user);

  // the happy path: placed -> paid -> shipped -> delivered, one email each
  const pid = await product(30, 10);
  await call("POST", "/cart/items", { productId: pid, quantity: 2 }, tk.user);
  const order = (await checkout(`key-${crypto.randomUUID()}`)).body.data;
  assert.deepEqual((await rows("order-placed:%")).map((r) => r.status), ["SENT"]);
  const placed = sent.filter((s) => s.key === `order-placed:${order.id}`).at(-1)!;
  assert.match(placed.subject, new RegExp(order.orderNumber));

  for (const s of ["PAID", "PROCESSING", "SHIPPED", "DELIVERED"]) assert.equal((await call("POST", `/admin/orders/${order.id}/status`, { status: s })).status, 200);
  assert.deepEqual((await rows("order-%")).map((r) => r.template), ["order-placed", "order-paid", "order-shipped", "order-delivered"]); // PROCESSING sends nothing
  await call("POST", `/admin/orders/${order.id}/status`, { status: "DELIVERED" }); // repeating a transition...
  assert.equal((await rows("order-delivered:%")).length, 1); // ...never emails twice

  // cancelling an unpaid order emails the customer
  await call("POST", "/cart/items", { productId: pid, quantity: 1 }, tk.user);
  const o2 = (await checkout(`key-${crypto.randomUUID()}`)).body.data;
  await call("POST", `/orders/${o2.id}/cancel`, { reason: "changed my mind" }, tk.user);
  const cancelled = (await pool.query(`SELECT payload FROM email_log WHERE dedupe_key = $1`, [`order-cancelled:${o2.id}`])).rows[0];
  assert.equal(cancelled.payload.reason, "changed my mind");
});

test("SCHEDULED JOBS: registered once however many times they are scheduled; cleanup removes only what is stale", async () => {
  await scheduleJobs();
  const q = getQueue(MAINTENANCE_QUEUE);
  const first = (await q.getJobSchedulers()).map((s) => s.key).sort();
  await scheduleJobs(); await scheduleJobs();
  assert.deepEqual((await q.getJobSchedulers()).map((s) => s.key).sort(), first); // idempotent
  for (const id of ["expire-reservations", "expire-orders", "email-dispatch", "cleanup"]) assert.ok(first.includes(id), id);
  assert.equal(typeof (await runMaintenance("email-dispatch")), "number");
  await assert.rejects(runMaintenance("nope"));

  const uid = (await pool.query(`SELECT id FROM users WHERE email = $1`, [emails.user])).rows[0].id;
  const ins = (key: string, status: string, age: string, tpl = "order-paid", payload = "{}") =>
    pool.query(`INSERT INTO email_log (dedupe_key, template, to_email, payload, status, created_at) VALUES ($1, $2, $3, $4, $5, now() - $6::interval)`, [key, tpl, rcpt("c"), payload, status, age]);
  await ins(`cleanup:${tag}:old-sent`, "SENT", "40 days");
  await ins(`cleanup:${tag}:new-sent`, "SENT", "1 day");
  await ins(`cleanup:${tag}:old-failed`, "FAILED", "40 days"); // failures are kept for investigation
  await ins(`cleanup:${tag}:old-secret`, "FAILED", "2 days", "verify-email", '{"link":"https://x.test/verify?token=LIVE"}');
  await pool.query(`INSERT INTO idempotency_keys (user_id, key, request_hash, created_at) VALUES ($1, $2, 'h', now() - interval '10 days'), ($1, $3, 'h', now())`, [uid, `old-${tag}`, `new-${tag}`]);

  const result = await runCleanup();
  assert.ok(result.emailsDeleted >= 1 && result.idempotencyKeys >= 1 && result.emailSecretsWiped >= 1);
  assert.equal(await row(`cleanup:${tag}:old-sent`), undefined);
  for (const k of ["new-sent", "old-failed"]) assert.ok(await row(`cleanup:${tag}:${k}`), k);
  assert.deepEqual((await row(`cleanup:${tag}:old-secret`)).payload, {}); // dead password-reset links are wiped after a day
  const keys = (await pool.query(`SELECT key FROM idempotency_keys WHERE key = ANY($1)`, [[`old-${tag}`, `new-${tag}`]])).rows.map((r) => r.key);
  assert.deepEqual(keys, [`new-${tag}`]);
});

test("BULL BOARD: off by default, behind basic auth when enabled", async () => {
  const hit = (auth?: string) => fetch(`${base}/admin/queues`, { headers: auth ? { authorization: auth } : {}, redirect: "manual" });
  const keep = process.env.BULL_BOARD_PASSWORD;
  try {
    delete process.env.BULL_BOARD_PASSWORD;
    assert.equal((await hit()).status, 404); // not configured: it doesn't exist
    process.env.BULL_BOARD_PASSWORD = "s3cret-board";
    const none = await hit();
    assert.equal(none.status, 401);
    assert.match(none.headers.get("www-authenticate") ?? "", /Basic/);
    assert.equal((await hit("Basic " + Buffer.from("admin:wrong").toString("base64"))).status, 401);
    assert.equal((await hit("Basic " + Buffer.from("root:s3cret-board").toString("base64"))).status, 401); // right password, wrong user
    const ok = await hit("Basic " + Buffer.from("admin:s3cret-board").toString("base64"));
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get("content-type") ?? "", /html/);
  } finally {
    if (keep === undefined) delete process.env.BULL_BOARD_PASSWORD; else process.env.BULL_BOARD_PASSWORD = keep;
  }
});
