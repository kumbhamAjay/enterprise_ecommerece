import "dotenv/config";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import app from "../../app";
import { pool } from "../../config/db";

// Reports are checked over a window in 2001, so real or other tests' orders can never leak into the numbers.
const tag = "an" + Math.random().toString(36).slice(2, 8);
const mk = (p: string) => `test_${p}_${crypto.randomUUID()}@example.com`;
const emails = { admin: mk("admin"), sup: mk("super"), cust: mk("cust"), cust2: mk("cust2"), other: mk("other") };
const password = "password123";
let server: Server, base: string;
const tk: Record<string, string> = {};
const uid: Record<string, string> = {};
const R = "from=2001-03-01&to=2001-03-05";

const call = async (method: string, path: string, body?: object, token = tk.admin) => {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
};
let n = 0;
async function order(user: string | null, status: string, total: number, paidAt: string | null, items: { sku: string; name: string; qty: number; price: number }[] = []) {
  const r = await pool.query(
    `INSERT INTO orders (order_number, user_id, customer_email, status, subtotal, total, shipping_address, billing_address, paid_at, placed_at)
     VALUES ($1, $2, $3, $4, $5, $5, '{}', '{}', $6, COALESCE($6::timestamptz, '2001-03-01')) RETURNING id`,
    [`${tag}-${++n}`, user, user ? emails.cust : "x@example.com", status, total, paidAt],
  );
  for (const i of items) await pool.query(`INSERT INTO order_items (order_id, sku, name, unit_price, quantity, line_total) VALUES ($1, $2, $3, $4::numeric, $5::int, round($4::numeric * $5::int, 2))`, [r.rows[0].id, i.sku, i.name, i.price, i.qty]);
}
const refresh = () => call("POST", "/admin/analytics/refresh");

before(async () => {
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  for (const e of Object.values(emails)) await call("POST", "/auth/register", { firstName: "T", email: e, password }, "");
  for (const [k, role] of [["admin", "ADMIN"], ["sup", "SUPER_ADMIN"]]) await pool.query(`INSERT INTO user_roles (user_id, role_id) SELECT u.id, r.id FROM users u, roles r WHERE u.email = $1 AND r.name = $2`, [emails[k as "admin"], role]);
  for (const [k, e] of Object.entries(emails)) {
    tk[k] = (await call("POST", "/auth/login", { email: e, password }, "")).body.data.accessToken;
    uid[k] = (await pool.query(`SELECT id FROM users WHERE email = $1`, [e])).rows[0].id;
  }
  // Window 2001-03-01..05. cust: two orders (100, 50); cust2: one (60). Plus a REFUNDED (80) and a CANCELLED (30) that must NOT count as revenue.
  await order(uid.cust, "DELIVERED", 100, "2001-03-01T10:00:00Z", [{ sku: `${tag}-A`, name: "Alpha", qty: 2, price: 40 }, { sku: `${tag}-B`, name: "Beta", qty: 1, price: 20 }]);
  await order(uid.cust, "SHIPPED", 50, "2001-03-03T23:30:00Z", [{ sku: `${tag}-A`, name: "Alpha", qty: 1, price: 40 }, { sku: `${tag}-C`, name: "Gamma", qty: 1, price: 10 }]);
  await order(uid.cust2, "PAID", 60, "2001-03-03T01:00:00Z", [{ sku: `${tag}-B`, name: "Beta", qty: 3, price: 20 }]);
  await order(uid.cust2, "REFUNDED", 80, "2001-03-02T12:00:00Z", [{ sku: `${tag}-A`, name: "Alpha", qty: 2, price: 40 }]);
  await order(uid.cust2, "CANCELLED", 30, "2001-03-02T12:00:00Z");
  await order(uid.cust2, "PENDING_PAYMENT", 999, null); // never paid
  await order(uid.cust, "DELIVERED", 75, "2001-02-25T10:00:00Z"); // previous period (same 5-day length right before)
  await refresh();
});

after(async () => {
  await pool.query(`DELETE FROM orders WHERE order_number LIKE $1`, [`${tag}-%`]);
  const ids = Object.values(uid);
  await pool.query(`DELETE FROM admin_audit_log WHERE actor_user_id = ANY($1) OR target_user_id = ANY($1)`, [ids]);
  await pool.query(`DELETE FROM users WHERE email = ANY($1)`, [Object.values(emails)]);
  await pool.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY sales_daily`); // purge the 2001 test rows from the report
  server.close();
  await pool.end();
});

test("summary: revenue counts only paid orders that still stand, and is compared with the previous period", async () => {
  const r = await call("GET", `/admin/analytics/summary?${R}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const d = r.body.data;
  assert.deepEqual([d.revenue.value, d.orders.value, d.avgOrderValue.value, d.buyers], [210, 3, 70, 2]); // 100 + 50 + 60; refunded, cancelled and unpaid excluded
  assert.deepEqual([d.revenue.previous, d.revenue.changePct], [75, 180]);
  assert.deepEqual(d.refunded, { orders: 1, total: 80 });
  const byStatus = Object.fromEntries(d.ordersByStatus.map((s: any) => [s.status, s.orders]));
  assert.equal(byStatus.REFUNDED, 1);
  assert.equal(byStatus.PENDING_PAYMENT, 1);
  const none = (await call("GET", "/admin/analytics/summary?from=2001-01-01&to=2001-01-05")).body.data;
  assert.deepEqual([none.revenue.value, none.revenue.changePct, none.avgOrderValue.value], [0, null, 0]); // no division by zero
});

test("revenue series: empty days are filled with zeros, with a running total and growth versus the previous bucket", async () => {
  const s = (await call("GET", `/admin/analytics/revenue?${R}`)).body.data.series;
  assert.deepEqual(s.map((x: any) => x.bucket), ["2001-03-01", "2001-03-02", "2001-03-03", "2001-03-04", "2001-03-05"]);
  assert.deepEqual(s.map((x: any) => x.revenue), [100, 0, 110, 0, 0]);
  assert.deepEqual(s.map((x: any) => x.cumulative), [100, 100, 210, 210, 210]);
  assert.equal(s[2].growthPct, null); // previous day had 0 revenue: growth is undefined, not Infinity
  assert.equal(s[1].growthPct, -100);

  const weeks = (await call("GET", `/admin/analytics/revenue?from=2001-02-26&to=2001-03-11&interval=week`)).body.data.series;
  assert.deepEqual(weeks.map((x: any) => [x.bucket, x.revenue]), [["2001-02-26", 210], ["2001-03-05", 0]]); // weeks start on Monday; the 75 on Sunday Feb 25 is outside the range
});

test("the daily report is a materialized view: new sales appear after a refresh, while the summary is live", async () => {
  await order(uid.cust, "PAID", 1000, "2001-03-04T09:00:00Z");
  const day4 = async () => (await call("GET", `/admin/analytics/revenue?${R}`)).body.data.series[3].revenue;
  assert.equal(await day4(), 0); // stale: the view has not been refreshed
  assert.equal((await call("GET", `/admin/analytics/summary?${R}`)).body.data.revenue.value, 1210); // live
  assert.equal((await refresh()).status, 200);
  assert.equal(await day4(), 1000);
  await pool.query(`DELETE FROM orders WHERE order_number = $1`, [`${tag}-${n}`]);
  await refresh();
});

test("top products: GROUP BY with HAVING, ranked, with each product's share of revenue", async () => {
  const all = (await call("GET", `/admin/analytics/top-products?${R}`)).body.data;
  const mine = all.filter((p: any) => p.sku.startsWith(tag));
  assert.deepEqual(mine.map((p: any) => [p.sku.slice(-1), p.units, p.revenue, p.rank]), [["A", 3, 120, 1], ["B", 4, 80, 2], ["C", 1, 10, 3]]); // refunded order (2 x A) is not counted
  assert.ok(Math.abs(all.reduce((s: number, p: any) => s + p.sharePct, 0) - 100) < 0.2);
  const popular = (await call("GET", `/admin/analytics/top-products?${R}&minUnits=3`)).body.data;
  assert.ok(popular.every((p: any) => p.units >= 3) && !popular.some((p: any) => p.sku.endsWith("-C"))); // HAVING drops the one-off
  assert.equal((await call("GET", `/admin/analytics/top-products?${R}&limit=1`)).body.data.length, 1);
});

test("top customers: ranked by spend; HAVING keeps only repeat buyers", async () => {
  const all = (await call("GET", `/admin/analytics/top-customers?${R}`)).body.data;
  assert.deepEqual(all.map((c: any) => [c.userId, c.orders, c.spend, c.avgOrder]), [[uid.cust, 2, 150, 75], [uid.cust2, 1, 60, 60]]);
  const repeat = (await call("GET", `/admin/analytics/top-customers?${R}&minOrders=2`)).body.data;
  assert.deepEqual(repeat.map((c: any) => c.userId), [uid.cust]);
});

test("analytics input validation and access control", async () => {
  for (const qs of ["from=2001-03-05&to=2001-03-01", "from=2001-13-45", "from=nope", "from=2000-01-01&to=2002-01-01", "interval=year"])
    assert.equal((await call("GET", `/admin/analytics/${qs.startsWith("interval") ? "revenue" : "summary"}?${qs}`)).status, 400, qs);
  assert.equal((await call("GET", "/admin/analytics/summary", undefined, tk.cust)).status, 403);
  assert.equal((await call("GET", "/admin/analytics/summary", undefined, "")).status, 401);
  assert.equal((await call("POST", "/admin/analytics/refresh", undefined, tk.cust)).status, 403);
});

test("user list: search, role and status filters, with lifetime orders and spend", async () => {
  const find = async (qs: string) => (await call("GET", `/admin/users?${qs}`)).body;
  const byEmail = await find(`q=${encodeURIComponent(emails.cust.split("@")[0])}`);
  assert.equal(byEmail.data.length, 1);
  assert.deepEqual([byEmail.data[0].email, byEmail.data[0].roles, byEmail.data[0].isActive, byEmail.data[0].orders > 0], [emails.cust, ["CUSTOMER"], true, true]);
  assert.ok(!("passwordHash" in byEmail.data[0]) && !("password_hash" in byEmail.data[0]));
  assert.deepEqual((await find(`q=test_super_&role=SUPER_ADMIN&limit=100`)).data.map((u: any) => u.id).includes(uid.sup), true);
  assert.equal((await find(`q=${encodeURIComponent(emails.cust.split("@")[0])}&status=disabled`)).data.length, 0);
  const paged = await find("limit=2&page=1");
  assert.equal(paged.data.length, 2);
  assert.ok(paged.meta.total >= 5 && paged.meta.totalPages >= 3);
  assert.equal((await call("GET", "/admin/users?q=%25")).status, 200); // LIKE wildcards in the search text are escaped, not interpreted
  assert.equal((await call("GET", "/admin/users", undefined, tk.cust)).status, 403);
  assert.equal((await call("GET", `/admin/users/${uid.cust}`)).body.data.recentOrders.length > 0, true);
  assert.equal((await call("GET", "/admin/users/999999999")).status, 404);
});

test("disabling an account ends its sessions immediately, and enabling restores login", async () => {
  const loginRes = await fetch(base + "/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: emails.other, password }) });
  const { accessToken, refreshToken } = (await loginRes.json()).data;
  assert.equal((await call("GET", "/orders", undefined, accessToken)).status, 200);

  const off = await call("PATCH", `/admin/users/${uid.other}/status`, { isActive: false });
  assert.equal(off.status, 200, JSON.stringify(off.body));
  assert.equal(off.body.data.isActive, false);
  assert.equal((await call("POST", "/auth/login", { email: emails.other, password }, "")).status, 401);
  assert.equal((await call("POST", "/auth/refresh", { refreshToken }, "")).status, 401);
  assert.equal((await call("GET", "/orders", undefined, accessToken)).status, 401); // the token issued before the ban no longer works

  assert.equal((await call("PATCH", `/admin/users/${uid.other}/status`, { isActive: true })).status, 200);
  assert.equal((await call("POST", "/auth/login", { email: emails.other, password }, "")).status, 200);
  const log = (await call("GET", `/admin/users/${uid.other}`)).body.data.audit.map((a: any) => a.action);
  assert.deepEqual(log, ["ENABLE_USER", "DISABLE_USER"]);
  const again = await call("PATCH", `/admin/users/${uid.other}/status`, { isActive: true }); // no-op: not audited twice
  assert.equal((await call("GET", `/admin/users/${uid.other}`)).body.data.audit.length, 2);
  assert.equal(again.status, 200);
});

test("who may do what: admins manage customers only; a super admin manages staff; nobody locks themselves out", async () => {
  assert.equal((await call("PATCH", `/admin/users/${uid.sup}/status`, { isActive: false })).status, 403); // admin cannot touch a super admin
  assert.equal((await call("PATCH", `/admin/users/${uid.admin}/status`, { isActive: false })).status, 400); // nor themselves
  assert.equal((await call("PATCH", `/admin/users/${uid.sup}/status`, { isActive: false }, tk.sup)).status, 400);
  assert.equal((await call("PATCH", `/admin/users/${uid.admin}/status`, { isActive: "no" })).status, 400);

  assert.equal((await call("PUT", `/admin/users/${uid.cust}/roles`, { roles: ["ADMIN"] })).status, 403); // role changes are super-admin only
  assert.equal((await call("PUT", `/admin/users/${uid.cust}/roles`, { roles: ["ROOT"] }, tk.sup)).status, 400);
  assert.equal((await call("PUT", `/admin/users/${uid.cust}/roles`, { roles: [] }, tk.sup)).status, 400);
  assert.equal((await call("PUT", `/admin/users/${uid.sup}/roles`, { roles: ["CUSTOMER"] }, tk.sup)).status, 400); // can't demote yourself
  assert.equal((await call("GET", `/admin/users/${uid.sup}`, undefined, tk.cust)).status, 403);
});

test("changing roles: audited, effective right away (the old token is rejected, the new one carries the new role)", async () => {
  const oldToken = tk.cust2;
  const r = await call("PUT", `/admin/users/${uid.cust2}/roles`, { roles: ["CUSTOMER", "ADMIN", "ADMIN"] }, tk.sup);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.data.roles, ["ADMIN", "CUSTOMER"]);
  assert.equal((await call("GET", "/admin/analytics/summary", undefined, oldToken)).status, 401); // stale roles inside it: must sign in again
  const fresh = (await call("POST", "/auth/login", { email: emails.cust2, password }, "")).body.data.accessToken;
  assert.equal((await call("GET", "/admin/analytics/summary", undefined, fresh)).status, 200);

  const entry = r.body.data.audit[0];
  assert.equal(entry.action, "SET_ROLES");
  assert.deepEqual(entry.detail, { from: ["CUSTOMER"], to: ["ADMIN", "CUSTOMER"] });
  assert.equal(entry.actorEmail, emails.sup);
});
