import "dotenv/config";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import app from "../../app";
import { pool } from "../../config/db";

// Letters-only unique tag: used in names/skus so search is isolated and cleanup is exact.
const tag = "zq" + Array.from({ length: 8 }, () => "abcdefghij"[Math.floor(Math.random() * 10)]).join("");
const adminEmail = `test_${crypto.randomUUID()}@example.com`;
const customerEmail = `test_${crypto.randomUUID()}@example.com`;
const password = "password123";
let server: Server, base: string, admin: string, customer: string;

const call = async (method: string, path: string, body?: object, token = admin) => {
  const r = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
};
const login = async (email: string) => (await call("POST", "/auth/login", { email, password }, "")).body.data.accessToken;

before(async () => {
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  for (const email of [adminEmail, customerEmail]) await call("POST", "/auth/register", { firstName: "T", email, password }, "");
  await pool.query(
    `INSERT INTO user_roles (user_id, role_id) SELECT u.id, r.id FROM users u, roles r WHERE u.email = $1 AND r.name = 'ADMIN'`,
    [adminEmail],
  );
  admin = await login(adminEmail); // log in AFTER the role grant so the JWT carries ADMIN
  customer = await login(customerEmail);
});

after(async () => {
  await pool.query(`DELETE FROM products WHERE sku LIKE $1`, [`${tag}%`]);
  await pool.query(`DELETE FROM categories WHERE name LIKE $1 AND parent_id IS NOT NULL`, [`${tag}%`]);
  await pool.query(`DELETE FROM categories WHERE name LIKE $1`, [`${tag}%`]);
  await pool.query(`DELETE FROM manufacturers WHERE name LIKE $1`, [`${tag}%`]);
  await pool.query(`DELETE FROM users WHERE email = ANY($1)`, [[adminEmail, customerEmail]]);
  server.close();
  await pool.end();
});

let manufacturerId: string, parentId: string, childId: string, A: any, B: any, C: any;

test("permissions: reads public, writes admin-only", async () => {
  assert.equal((await call("GET", "/products", undefined, "")).status, 200);
  assert.equal((await call("POST", "/categories", { name: "x" }, "")).status, 401);
  assert.equal((await call("POST", "/categories", { name: `${tag}-x` }, customer)).status, 403);
});

test("manufacturers + category tree", async () => {
  const m = await call("POST", "/manufacturers", { name: `${tag} Corp` });
  assert.equal(m.status, 201);
  manufacturerId = m.body.data.id;
  assert.equal((await call("POST", "/manufacturers", { name: `${tag} Corp` })).status, 409);

  const parent = await call("POST", "/categories", { name: `${tag}-parent` });
  assert.equal(parent.body.data.slug, `${tag}-parent`);
  parentId = parent.body.data.id;
  childId = (await call("POST", "/categories", { name: `${tag}-child`, parentId })).body.data.id;

  assert.equal((await call("DELETE", `/categories/${parentId}`)).status, 409); // has a child
  assert.equal((await call("PATCH", `/categories/${parentId}`, { parentId })).status, 400); // own parent
  assert.equal((await call("GET", "/categories/999999999", undefined, "")).status, 404);
});

test("create products: validation, duplicate sku, detail shape", async () => {
  assert.equal((await call("POST", "/products", { sku: `${tag}-0`, name: "x", price: -1 })).status, 400);

  A = (await call("POST", "/products", {
    sku: `${tag}-1`, name: `${tag} Alpha Phone`, description: "small and fast", price: 10,
    manufacturerId, categoryIds: [childId], images: [{ url: "https://img.test/a1.png" }, { url: "https://img.test/a2.png" }],
  })).body.data;
  B = (await call("POST", "/products", { sku: `${tag}-2`, name: `${tag} Beta Laptop`, price: 50, categoryIds: [parentId] })).body.data;
  C = (await call("POST", "/products", { sku: `${tag}-3`, name: `${tag} Gamma Phone`, price: 30 })).body.data;

  assert.equal((await call("POST", "/products", { sku: `${tag}-1`, name: "dup", price: 1 })).status, 409);

  const d = (await call("GET", `/products/${A.id}`, undefined, "")).body.data;
  assert.equal(d.price, "10.00");
  assert.equal(d.slug, `${tag}-alpha-phone`);
  assert.equal(d.manufacturer.name, `${tag} Corp`);
  assert.deepEqual(d.categories.map((c: any) => c.id), [childId]);
  assert.deepEqual(d.images.map((i: any) => i.position), [0, 1]);
});

test("list: search, category subtree, price range, sort, pagination", async () => {
  const list = async (qs: string) => (await call("GET", `/products?${qs}`, undefined, "")).body;
  const names = (r: any) => r.data.map((p: any) => p.name.replace(`${tag} `, ""));

  assert.equal((await list(`q=${tag}`)).meta.total, 3);
  assert.deepEqual(names(await list(`q=${tag} phone&sort=name`)), ["Alpha Phone", "Gamma Phone"]);

  assert.equal((await list(`categoryId=${parentId}&q=${tag}`)).meta.total, 2); // B (direct) + A (child category)
  assert.deepEqual(names(await list(`categoryId=${childId}`)), ["Alpha Phone"]);

  assert.deepEqual(names(await list(`q=${tag}&minPrice=20&maxPrice=40`)), ["Gamma Phone"]);
  assert.deepEqual(names(await list(`q=${tag}&sort=price_desc`)), ["Beta Laptop", "Gamma Phone", "Alpha Phone"]);
  assert.equal((await list(`manufacturerId=${manufacturerId}`)).data[0].imageUrl, "https://img.test/a1.png");

  const p2 = await list(`q=${tag}&sort=price_asc&limit=2&page=2`);
  assert.deepEqual(p2.meta, { page: 2, limit: 2, total: 3, totalPages: 2 });
  assert.deepEqual(names(p2), ["Beta Laptop"]);
  assert.equal((await call("GET", "/products?limit=1000", undefined, "")).status, 400);
});

test("update: replace categories, clear manufacturer", async () => {
  const u = await call("PATCH", `/products/${A.id}`, { price: 99, manufacturerId: null, categoryIds: [parentId] });
  assert.equal(u.status, 200);
  assert.equal(u.body.data.price, "99.00");
  assert.equal(u.body.data.manufacturer, null);
  assert.deepEqual(u.body.data.categories.map((c: any) => c.id), [parentId]);
  assert.equal((await call("PATCH", "/products/999999999", { price: 1 })).status, 404);
});

test("images: add, auto position, delete", async () => {
  const img = (await call("POST", `/products/${C.id}/images`, { url: "https://img.test/c.png" })).body.data;
  assert.equal(img.position, 0);
  assert.equal((await call("POST", `/products/${C.id}/images`, { url: "not-a-url" })).status, 400);
  assert.equal((await call("DELETE", `/products/${C.id}/images/${img.id}`)).status, 204);
  assert.equal((await call("DELETE", `/products/${C.id}/images/${img.id}`)).status, 404);
});

test("soft delete hides the product, PATCH reactivates", async () => {
  assert.equal((await call("DELETE", `/products/${C.id}`)).status, 204);
  assert.equal((await call("GET", `/products/${C.id}`, undefined, "")).status, 404);
  assert.equal((await call("GET", `/products?q=${tag}`, undefined, "")).body.meta.total, 2);
  assert.equal((await call("PATCH", `/products/${C.id}`, { isActive: true })).status, 200);
  assert.equal((await call("GET", `/products?q=${tag}`, undefined, "")).body.meta.total, 3);
});
