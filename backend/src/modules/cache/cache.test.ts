import "dotenv/config";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import Redis from "ioredis";
import app from "../../app";
import { pool } from "../../config/db";
import { getRedis, redisStatus, setRedisClient } from "../../config/redis";
import { bumpCatalog, cached, catalogKey } from "../../utils/cache";
import { withLock } from "../../utils/lock";
import { outbox } from "../../utils/mailer";
import { slidingWindow } from "../../utils/rateLimit";

const tag = "zq" + Array.from({ length: 8 }, () => "abcdefghij"[Math.floor(Math.random() * 10)]).join("");
const emails = { admin: `test_${crypto.randomUUID()}@example.com`, user: `test_${crypto.randomUUID()}@example.com` };
const password = "password123";
let server: Server, base: string, n = 0;
const tk: Record<string, string> = {};
const raw = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379"); // un-prefixed connection, to inspect and clean up
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const call = async (method: string, path: string, body?: object, token = tk.admin, headers: Record<string, string> = {}) => {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }), ...headers }, body: body && JSON.stringify(body) });
  return { status: r.status, cache: r.headers.get("x-cache"), headers: r.headers, body: r.status === 204 ? null : await r.json() };
};
const product = async (price = 10, stock = 10) => {
  const r = await call("POST", "/products", { sku: `${tag}-${++n}`, name: `${tag} Piece ${n}`, price, stock });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.data.id as string;
};
const ready = async () => { const r = getRedis(); if (r.status !== "ready") await new Promise((res) => { r.once("ready", () => res(null)); setTimeout(() => res(null), 3000); }); };

before(async () => {
  await ready();
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  for (const e of Object.values(emails)) await call("POST", "/auth/register", { firstName: "T", email: e, password }, "");
  await pool.query(`INSERT INTO user_roles (user_id, role_id) SELECT u.id, r.id FROM users u, roles r WHERE u.email = $1 AND r.name = 'ADMIN'`, [emails.admin]);
  for (const [k, e] of Object.entries(emails)) tk[k] = (await call("POST", "/auth/login", { email: e, password }, "")).body.data.accessToken;
});

after(async () => {
  process.env.RATE_LIMIT_DISABLED = "1";
  setRedisClient(undefined);
  const keys = await raw.keys("test:*");
  if (keys.length) await raw.del(...keys); // only this suite's namespace
  raw.disconnect();
  await pool.query(`DELETE FROM categories WHERE name LIKE $1`, [`${tag}%`]);
  await pool.query(`DELETE FROM manufacturers WHERE name LIKE $1`, [`${tag}%`]);
  await pool.query(`DELETE FROM products WHERE sku LIKE $1`, [`${tag}%`]);
  await pool.query(`DELETE FROM users WHERE email LIKE 'test\\_%@example.com' AND email = ANY($1)`, [Object.values(emails)]);
  server.close();
  await pool.end();
  getRedis().disconnect();
});

test("cache-aside: the first read misses, the next is served from Redis, and it is much faster", async () => {
  const id = await product();
  const t = async () => { const s = performance.now(); const r = await call("GET", `/products/${id}`, undefined, ""); return { r, ms: performance.now() - s }; };
  const miss = await t(), hit = await t();
  assert.deepEqual([miss.r.cache, hit.r.cache], ["MISS", "HIT"]);
  assert.deepEqual(hit.r.body, miss.r.body); // identical payload
  console.log(`   product detail: MISS ${miss.ms.toFixed(0)} ms (database over the network) -> HIT ${hit.ms.toFixed(0)} ms (Redis)`);
  assert.ok(hit.ms < miss.ms);
  assert.equal((await call("GET", "/products?limit=3", undefined, "")).cache, "MISS");
  assert.equal((await call("GET", "/products?limit=3", undefined, "")).cache, "HIT");
  assert.equal((await call("GET", "/products?limit=4", undefined, "")).cache, "MISS"); // different query, different key
});

test("INVALIDATION: every kind of write is visible immediately, never a stale read", async () => {
  const id = await product(10, 10);
  await call("GET", `/products/${id}`, undefined, "");
  assert.equal((await call("GET", `/products/${id}`, undefined, "")).cache, "HIT");

  await call("PATCH", `/products/${id}`, { price: 99 });
  const after = await call("GET", `/products/${id}`, undefined, "");
  assert.deepEqual([after.cache, after.body.data.price], ["MISS", "99.00"]);

  // lists and search: a new product shows up in a cached search straight away
  await call("GET", `/products?q=${tag}&limit=50`, undefined, "");
  assert.equal((await call("GET", `/products?q=${tag}&limit=50`, undefined, "")).cache, "HIT");
  const before = (await call("GET", `/products?q=${tag}&limit=50`, undefined, "")).body.meta.total;
  const id2 = await product();
  const listed = await call("GET", `/products?q=${tag}&limit=50`, undefined, "");
  assert.deepEqual([listed.cache, listed.body.meta.total], ["MISS", before + 1]);

  // admin stock change flips the public badge at once
  await call("GET", `/products/${id2}`, undefined, "");
  await call("PUT", `/inventory/${id2}/stock`, { quantity: 0 });
  assert.equal((await call("GET", `/products/${id2}`, undefined, "")).body.data.stockStatus, "OUT_OF_STOCK");

  // deactivating: the detail is a 404 (and errors are never cached), the list drops it
  await call("DELETE", `/products/${id2}`);
  assert.equal((await call("GET", `/products/${id2}`, undefined, "")).status, 404);
  assert.equal((await call("GET", `/products/${id2}`, undefined, "")).status, 404);
  assert.equal((await call("GET", `/products?q=${tag}&limit=50`, undefined, "")).body.data.some((p: any) => p.id === id2), false);

  // categories and brands
  const cat = (await call("POST", "/categories", { name: `${tag}-cat` })).body.data;
  await call("GET", "/categories", undefined, "");
  assert.equal((await call("GET", "/categories", undefined, "")).cache, "HIT");
  await call("PATCH", `/categories/${cat.id}`, { name: `${tag}-renamed` });
  const cats = await call("GET", "/categories", undefined, "");
  assert.deepEqual([cats.cache, cats.body.data.some((c: any) => c.name === `${tag}-renamed`)], ["MISS", true]);
  const brand = (await call("POST", "/manufacturers", { name: `${tag}-brand` })).body.data;
  assert.ok((await call("GET", "/manufacturers", undefined, "")).body.data.some((m: any) => m.id === brand.id));
});

test("RACE: a slow reader that overlaps a write cannot leave stale data in the cache", async () => {
  const key = await catalogKey("race-demo"); // version read BEFORE the slow load starts
  const slow = cached(key, 60, async () => { await sleep(300); return "STALE (read before the write)"; });
  await sleep(50);
  await bumpCatalog(); // a write commits while the slow reader is still loading
  await slow; // the slow reader finishes and stores its result...
  const fresh = await cached(await catalogKey("race-demo"), 60, async () => "FRESH"); // ...but new readers use the NEW version
  assert.equal(fresh, "FRESH");
});

test("STAMPEDE: 50 simultaneous misses rebuild once in-process, and once across 'instances' via the Redis lock", async () => {
  let loads = 0;
  const loader = async () => { loads++; await sleep(200); return { v: loads }; };
  const same = await Promise.all(Array.from({ length: 50 }, () => cached(`stampede:a:${tag}`, 60, loader)));
  assert.equal(loads, 1);
  assert.equal(new Set(same.map((x) => x.v)).size, 1);

  loads = 0; // simulate separate processes: no in-process sharing, only the Redis lock stands between them and the database
  const many = await Promise.all(Array.from({ length: 30 }, () => cached(`stampede:b:${tag}`, 60, loader, { singleFlight: false })));
  assert.equal(loads, 1);
  assert.equal(new Set(many.map((x) => x.v)).size, 1);
});

test("TTL: entries expire, with +-10% jitter so they don't all expire together", async () => {
  const ttls: number[] = [];
  for (let i = 0; i < 12; i++) {
    await cached(`ttl:${tag}:${i}`, 10, async () => i);
    ttls.push(await raw.pttl(`test:ttl:${tag}:${i}`));
  }
  assert.ok(ttls.every((t) => t >= 8800 && t <= 11100), ttls.join());
  assert.ok(new Set(ttls).size > 1, "TTLs should differ");

  let loads = 0;
  const get = () => cached(`ttl:expire:${tag}`, 1, async () => ++loads);
  await get(); await get();
  assert.equal(loads, 1);
  await sleep(1300);
  await get();
  assert.equal(loads, 2); // expired, rebuilt
});

test("RATE LIMITING: sliding window, atomic under concurrency, per IP + email", async () => {
  // the algorithm itself
  const burst = await Promise.all(Array.from({ length: 20 }, () => slidingWindow(`burst:${tag}`, 5, 5000)));
  assert.equal(burst.filter((v) => v?.allowed).length, 5); // exactly 5 of 20 simultaneous requests: the Lua script is atomic
  const a = [1, 2, 3, 4].map(() => slidingWindow(`seq:${tag}`, 3, 800));
  const seq = [await a[0], await a[1], await a[2], await a[3]];
  assert.deepEqual(seq.map((v) => v?.allowed).sort(), [false, true, true, true]);
  await sleep(900); // the window slides: old entries age out
  assert.equal((await slidingWindow(`seq:${tag}`, 3, 800))?.allowed, true);

  // on the real login endpoint
  process.env.RATE_LIMIT_DISABLED = "0";
  try {
    const email = `nobody_${tag}@example.com`;
    const login = (e: string, ip?: string) => call("POST", "/auth/login", { email: e, password: "wrongpass1" }, "", ip ? { "X-Forwarded-For": ip } : {});
    for (let i = 0; i < 10; i++) assert.equal((await login(email)).status, 401);
    const blocked = await login(email);
    assert.equal(blocked.status, 429);
    assert.match(blocked.body.message, /Too many attempts/);
    assert.ok(Number(blocked.headers.get("retry-after")) > 0);
    assert.equal(blocked.headers.get("ratelimit-remaining"), "0");
    assert.equal((await login(`other_${tag}@example.com`)).status, 401); // another account is unaffected
    assert.equal((await login(email, "203.0.113.7")).status, 401); // another client IP (via the trusted proxy header) is unaffected
  } finally {
    process.env.RATE_LIMIT_DISABLED = "1";
  }
});

test("TOKEN REVOCATION: a password change ends old access tokens immediately, not 15 minutes later", async () => {
  const email = `test_${crypto.randomUUID()}@example.com`;
  await call("POST", "/auth/register", { firstName: "R", email, password }, "");
  const login = async (pw: string) => (await call("POST", "/auth/login", { email, password: pw }, "")).body.data?.accessToken as string;
  const old = await login(password);
  assert.equal((await call("GET", "/auth/me", undefined, old)).status, 200);

  await sleep(1100); // iat has 1-second resolution
  assert.equal((await call("POST", "/users/me/password", { currentPassword: password, newPassword: "newpassword456" }, old)).status, 200);
  const dead = await call("GET", "/auth/me", undefined, old);
  assert.equal(dead.status, 401); // the JWT is still cryptographically valid; Redis says it was revoked
  assert.match(dead.body.message, /session ended/i);
  const fresh = await login("newpassword456");
  assert.equal((await call("GET", "/auth/me", undefined, fresh)).status, 200); // a new login works right away

  // same for a password reset
  await sleep(1100);
  await call("POST", "/auth/forgot-password", { email }, "");
  const token = outbox.at(-1)!.text.match(/token=(\w+)/)![1];
  assert.equal((await call("POST", "/auth/reset-password", { token, password: "anotherpass789" }, "")).status, 200);
  assert.equal((await call("GET", "/auth/me", undefined, fresh)).status, 401);
  await pool.query(`DELETE FROM users WHERE email = $1`, [email]);
});

test("REDIS DOWN: the site keeps working (uncached, unthrottled), it never fails because of the cache", async () => {
  const dead = () => Promise.reject(new Error("redis is down"));
  setRedisClient({ status: "end", get: dead, set: dead, incr: dead, eval: dead, ping: dead });
  process.env.RATE_LIMIT_DISABLED = "0"; // rate limiting ON, to prove it fails open
  try {
    const id = await product(); // an admin write while Redis is down: the DB commit succeeds, invalidation silently skipped
    const r = await call("GET", `/products/${id}`, undefined, "");
    assert.deepEqual([r.status, r.cache], [200, "BYPASS"]); // served straight from the database
    assert.equal((await call("GET", "/products?limit=2", undefined, "")).status, 200);
    assert.equal((await call("GET", "/categories", undefined, "")).status, 200);
    const l = await call("POST", "/auth/login", { email: emails.user, password }, ""); // limiter fails open
    assert.equal(l.status, 200);
    assert.equal((await call("GET", "/auth/me", undefined, l.body.data.accessToken)).status, 200); // revocation check fails open
    assert.equal(redisStatus(), "down"); // circuit breaker is open: later requests don't even try Redis

    const s = performance.now();
    for (let i = 0; i < 30; i++) await call("GET", `/products/${id}`, undefined, "");
    console.log(`   30 requests with Redis down: ${(performance.now() - s).toFixed(0)} ms total (about one database round trip each, no Redis timeout penalty)`);
  } finally {
    process.env.RATE_LIMIT_DISABLED = "1";
    setRedisClient(undefined); // reconnect to the real one
    await ready();
  }
  const id = await product();
  await call("GET", `/products/${id}`, undefined, "");
  assert.equal((await call("GET", `/products/${id}`, undefined, "")).cache, "HIT"); // and the cache is back
});

test("DISTRIBUTED LOCK: mutual exclusion, and the documented limitation when the holder is too slow", async () => {
  const order: string[] = [];
  const [a, b] = await Promise.all([
    withLock(`job:${tag}`, 2000, async () => { order.push("a-start"); await sleep(200); order.push("a-end"); return "A"; }),
    withLock(`job:${tag}`, 2000, async () => { order.push("b"); return "B"; }),
  ]);
  assert.deepEqual([a.ran, b.ran].sort(), [false, true]); // only one ran
  assert.ok(!order.includes("b") || !order.includes("a-start"));
  assert.equal((await withLock(`job:${tag}`, 2000, async () => "again")).ran, true); // released, so free again

  // limitation: the TTL is 150 ms but the work takes 400 ms, so the lock expires while the first holder is still running
  const running: string[] = [];
  const slow = withLock(`slow:${tag}`, 150, async () => { running.push("first"); await sleep(400); running.push("first-done"); });
  await sleep(250);
  const intruder = await withLock(`slow:${tag}`, 150, async () => { running.push("second"); });
  await slow;
  assert.equal(intruder.ran, true); // two holders at once: a lock gives efficiency, not safety
  assert.deepEqual(running, ["first", "second", "first-done"]);
});

test("admin cache endpoints: stats and an emergency flush", async () => {
  assert.equal((await call("GET", "/admin/cache", undefined, tk.user)).status, 403);
  const id = await product();
  await call("GET", `/products/${id}`, undefined, ""); await call("GET", `/products/${id}`, undefined, "");
  const s = (await call("GET", "/admin/cache")).body.data;
  assert.equal(s.redis, "ready");
  assert.ok(s.hits >= 1 && s.misses >= 1 && typeof s.hitRate === "number");

  const v1 = s.catalogVersion;
  const flushed = (await call("POST", "/admin/cache/flush", {})).body.data;
  assert.equal(Number(flushed.catalogVersion), Number(v1) + 1);
  assert.equal((await call("GET", `/products/${id}`, undefined, "")).cache, "MISS"); // everything was orphaned in one O(1) step
});
