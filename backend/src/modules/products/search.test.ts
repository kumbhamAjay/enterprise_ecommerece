import "dotenv/config";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import app from "../../app";
import { dbStats, pool } from "../../config/db";

const tag = "zq" + Array.from({ length: 8 }, () => "abcdefghij"[Math.floor(Math.random() * 10)]).join("");
const emails = { admin: `test_${crypto.randomUUID()}@example.com`, user: `test_${crypto.randomUUID()}@example.com` };
const password = "password123";
let server: Server, base: string, n = 0;
const tk: Record<string, string> = {};

const call = async (method: string, path: string, body?: object, token = tk.admin) => {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
};
const product = async (o: { price?: number; name?: string; description?: string; stock?: number } = {}) => {
  const r = await call("POST", "/products", { sku: `${tag}-${++n}`, name: o.name ?? `${tag} Item ${n}`, price: o.price ?? 10, stock: o.stock ?? 5, ...(o.description && { description: o.description }) });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.data.id as string;
};
const list = (qs: string) => call("GET", `/products?q=${tag}&${qs}`, undefined, "");
const ids = (r: { body: any }) => r.body.data.map((p: any) => p.id as string);

/** walk every page with cursors; returns all ids in order */
async function walk(qs: string, limit: number) {
  const seen: string[] = [];
  let r = await list(`${qs}&limit=${limit}`);
  for (let guard = 0; guard < 50; guard++) {
    seen.push(...ids(r));
    if (!r.body.meta.hasMore) {
      assert.equal(r.body.meta.nextCursor, null);
      return seen;
    }
    assert.ok(r.body.meta.nextCursor, "hasMore without a cursor");
    r = await list(`${qs}&limit=${limit}&cursor=${encodeURIComponent(r.body.meta.nextCursor)}`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  throw new Error("pagination never ended");
}

before(async () => {
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  for (const e of Object.values(emails)) await call("POST", "/auth/register", { firstName: "T", email: e, password }, "");
  await pool.query(`INSERT INTO user_roles (user_id, role_id) SELECT u.id, r.id FROM users u, roles r WHERE u.email = $1 AND r.name = 'ADMIN'`, [emails.admin]);
  for (const [k, e] of Object.entries(emails)) tk[k] = (await call("POST", "/auth/login", { email: e, password }, "")).body.data.accessToken;
});

after(async () => {
  await pool.query(`DELETE FROM carts WHERE user_id IN (SELECT id FROM users WHERE email = ANY($1))`, [Object.values(emails)]);
  await pool.query(`DELETE FROM products WHERE sku LIKE $1`, [`${tag}%`]);
  await pool.query(`DELETE FROM users WHERE email = ANY($1)`, [Object.values(emails)]);
  server.close();
  await pool.end();
});

test("KEYSET pagination: walking every page returns every product exactly once, in order, for every sort (ties included)", async () => {
  // 23 products with deliberately duplicated prices, so the (value, id) tie-breaker is what keeps the order stable
  for (let i = 0; i < 23; i++) await product({ price: [5, 5, 5, 12.5, 12.5, 30][i % 6], name: `${tag} ${["Gamma", "Alpha", "Beta"][i % 3]} ${i}` }); // names must be unique (slug), prices tie

  for (const sort of ["newest", "price_asc", "price_desc", "name"]) {
    const truth = ids(await list(`sort=${sort}&limit=100`)); // one big page = ground truth
    assert.equal(truth.length, 23);
    const walked = await walk(`sort=${sort}`, 7); // 4 pages of 7
    assert.deepEqual(walked, truth, `${sort}: pages must reassemble the full list`);
    assert.equal(new Set(walked).size, 23, `${sort}: no duplicates`);
  }
  const prices = (await list("sort=price_asc&limit=100")).body.data.map((p: any) => Number(p.price));
  assert.deepEqual(prices, [...prices].sort((a, b) => a - b));
});

test("keyset pages stay correct when products are inserted while the shopper is browsing (OFFSET pages would shift)", async () => {
  const first = await list("sort=newest&limit=5");
  const page1 = ids(first);
  await product({ name: `${tag} Brand New Arrival` }); // someone adds a product after page 1 was shown

  const viaCursor = await list(`sort=newest&limit=5&cursor=${encodeURIComponent(first.body.meta.nextCursor)}`);
  const viaOffset = await list("sort=newest&limit=5&page=2");
  assert.ok(!ids(viaCursor).some((id: string) => page1.includes(id)), "cursor page 2 must not repeat anything from page 1");
  assert.ok(ids(viaOffset).some((id: string) => page1.includes(id)), "OFFSET page 2 repeats a row from page 1: the classic shifting-page bug");
});

test("cursor safety: garbage, tampered and foreign cursors are rejected; deep page numbers are capped", async () => {
  const first = await list("sort=price_asc&limit=5");
  const cur = first.body.meta.nextCursor as string;
  assert.equal((await list("limit=5&cursor=not-a-cursor")).status, 400);
  assert.equal((await list("limit=5&cursor=" + Buffer.from('{"s":"price_asc","v":["x","y"],"h":"zzz"}').toString("base64url"))).status, 400);
  assert.equal((await call("GET", `/products?q=${tag}-other&sort=price_asc&limit=5&cursor=${encodeURIComponent(cur)}`, undefined, "")).status, 400); // cursor belongs to a different search

  const decoded = JSON.parse(Buffer.from(cur, "base64url").toString());
  const forged = Buffer.from(JSON.stringify({ ...decoded, v: ["not-a-number", "1"] })).toString("base64url"); // right filters, poisoned value
  assert.equal((await list(`sort=price_asc&limit=5&cursor=${encodeURIComponent(forged)}`)).status, 400);

  const deep = await list("limit=20&page=1000"); // OFFSET 19,980: refused, with advice
  assert.equal(deep.status, 400);
  assert.match(deep.body.message, /cursor/i);
  assert.equal((await list("limit=20&page=3")).status, 200);
});

test("meta: exact totals while small, no total on cursor pages, and the sort actually used", async () => {
  const m = (await list("sort=name&limit=10")).body.meta;
  assert.deepEqual([m.page, m.limit, m.total, m.totalCapped, m.hasMore, m.sortedBy], [1, 10, 24, false, true, "name"]);
  assert.equal(m.totalPages, 3);
  const next = (await list(`sort=name&limit=10&cursor=${encodeURIComponent(m.nextCursor)}`)).body.meta;
  assert.equal(next.total, null); // not recounted: the client keeps the first page's total
  assert.equal(next.page, undefined);
});

test("relevance ranks by how well the text matches (small result sets are ranked, not just newest-first)", async () => {
  const word = `${tag}rank`;
  const weak = await product({ name: `${tag} Plain thing`, description: `A ${word}.` });
  const strong = await product({ name: `${tag} Other thing`, description: `${word} ${word} ${word} ${word} ${word}.` });
  const r = await call("GET", `/products?q=${word}`, undefined, "");
  assert.equal(r.body.meta.sortedBy, "relevance");
  assert.deepEqual(ids(r), [strong, weak]); // five mentions outrank one, even though `weak` is newer than... nothing: rank decides
  // an explicit price sort is honoured too
  assert.equal((await call("GET", `/products?q=${word}&sort=price_asc`, undefined, "")).body.meta.sortedBy, "price_asc");
});

test("N+1 GUARD: a page of 50 products costs the same number of queries as a page of 2", async () => {
  const queriesFor = async (path: string, token = "") => { const before = dbStats.queries; const r = await call("GET", path, undefined, token); assert.equal(r.status, 200); return dbStats.queries - before; };
  // maxPrice makes each URL unique, so the response cache cannot answer it
  const small = await queriesFor(`/products?q=${tag}&limit=2&maxPrice=9001`);
  const big = await queriesFor(`/products?q=${tag}&limit=50&maxPrice=9002`);
  console.log(`   product list: ${small} queries for 2 products, ${big} queries for 50 products`);
  assert.equal(small, big); // constant: images, brand and stock are joined/subselected, never fetched per product
  assert.ok(big <= 2, `expected count + page = 2 queries, got ${big}`);

  const one = (await call("GET", `/products?q=${tag}&limit=1`, undefined, "")).body.data[0].id;
  assert.equal(await queriesFor(`/products/${one}`), 1); // detail: manufacturer, categories and images in ONE query

  for (let i = 0; i < 8; i++) assert.equal((await call("POST", "/cart/items", { productId: await product({ stock: 9 }), quantity: 1 }, tk.user)).status, 201);
  assert.equal(await queriesFor("/cart", tk.user), 1); // 8 cart lines, still one query
});

test("the Module 9 indexes exist, and the superseded ones are gone", async () => {
  const have = (await pool.query(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename IN ('products', 'product_categories')`)).rows.map((r) => r.indexname);
  for (const i of ["products_newest_idx", "products_price_idx", "products_name_idx", "products_mfr_newest_idx", "products_search_idx", "product_categories_cat_product_idx"]) assert.ok(have.includes(i), `missing index ${i}`);
  for (const i of ["products_active_price_idx", "products_manufacturer_idx", "product_categories_category_idx"]) assert.ok(!have.includes(i), `${i} should have been replaced`);
});

test("diagnostics: admin only, with pool, query and event-loop numbers", async () => {
  assert.equal((await call("GET", "/admin/diagnostics", undefined, tk.user)).status, 403);
  assert.equal((await call("GET", "/admin/diagnostics", undefined, "")).status, 401);
  const d = (await call("GET", "/admin/diagnostics")).body.data;
  assert.ok(d.db.pool.max >= 1 && d.db.queries > 0 && d.db.avgQueryMs >= 0);
  assert.ok("p99" in d.process.eventLoopDelayMs && d.process.rssMb > 0);
  assert.ok(d.cache.redis);
});
