import "dotenv/config";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { v2 as cloudinary } from "cloudinary";
import app from "../../app";
import { pool } from "../../config/db";
import { setDestroyerForTests } from "../../config/cloudinary";

// Fake credentials: nothing here talks to Cloudinary. The signature is checked against Cloudinary's OWN signing function.
const CLOUD = "test-cloud", KEY = "123456789012345", SECRET = "s3cr3t-value-that-must-never-leak";
const saved = { ...process.env };
Object.assign(process.env, { CLOUDINARY_CLOUD_NAME: CLOUD, CLOUDINARY_API_KEY: KEY, CLOUDINARY_API_SECRET: SECRET });
delete process.env.CLOUDINARY_URL;

const tag = "zq" + Array.from({ length: 8 }, () => "abcdefghij"[Math.floor(Math.random() * 10)]).join("");
const emails = { admin: `test_${crypto.randomUUID()}@example.com`, user: `test_${crypto.randomUUID()}@example.com` };
const password = "password123";
let server: Server, base: string, n = 0;
const tk: Record<string, string> = {};
const destroyed: string[] = [];

const call = async (method: string, path: string, body?: object, token = tk.admin) => {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) });
  return { status: r.status, text: await r.text(), get body() { return this.text ? JSON.parse(this.text) : null; } };
};
const product = async (images?: object[]) => {
  const r = await call("POST", "/products", { sku: `${tag}-${++n}`, name: `${tag} Piece ${n}`, price: 10, stock: 5, ...(images && { images }) });
  assert.equal(r.status, 201, r.text);
  return r.body.data;
};
const asset = (id: string) => ({ url: `https://res.cloudinary.com/${CLOUD}/image/upload/v1700000000/shopeasy/products/${id}.jpg`, publicId: `shopeasy/products/${id}` });

before(async () => {
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  for (const e of Object.values(emails)) await call("POST", "/auth/register", { firstName: "T", email: e, password }, "");
  await pool.query(`INSERT INTO user_roles (user_id, role_id) SELECT u.id, r.id FROM users u, roles r WHERE u.email = $1 AND r.name = 'ADMIN'`, [emails.admin]);
  for (const [k, e] of Object.entries(emails)) tk[k] = (await call("POST", "/auth/login", { email: e, password }, "")).body.data.accessToken;
  setDestroyerForTests(async (id) => { destroyed.push(id); });
});

after(async () => {
  setDestroyerForTests(undefined);
  Object.assign(process.env, saved);
  await pool.query(`DELETE FROM products WHERE sku LIKE $1`, [`${tag}%`]);
  await pool.query(`DELETE FROM users WHERE email = ANY($1)`, [Object.values(emails)]);
  server.close();
  await pool.end();
});

test("signing: admin only, correct signature, and the secret never leaves the server", async () => {
  assert.equal((await call("POST", "/admin/uploads/sign", {}, "")).status, 401);
  assert.equal((await call("POST", "/admin/uploads/sign", {}, tk.user)).status, 403);

  const r = await call("POST", "/admin/uploads/sign", {});
  assert.equal(r.status, 200);
  const d = r.body.data;
  const expected = cloudinary.utils.api_sign_request({ allowed_formats: d.allowedFormats, folder: d.folder, timestamp: d.timestamp }, SECRET);
  assert.equal(d.signature, expected); // exactly what Cloudinary will recompute and compare
  assert.deepEqual([d.cloudName, d.apiKey, d.folder], [CLOUD, KEY, "shopeasy/products"]);
  assert.equal(d.uploadUrl, `https://api.cloudinary.com/v1_1/${CLOUD}/image/upload`);
  assert.ok(Math.abs(d.timestamp - Date.now() / 1000) < 10);
  assert.ok(!r.text.includes(SECRET)); // the API secret is never in a response
});

test("signing falls back to CLOUDINARY_URL, and says 'not configured' (503) when nothing is set", async () => {
  const keep = { n: process.env.CLOUDINARY_CLOUD_NAME, k: process.env.CLOUDINARY_API_KEY, s: process.env.CLOUDINARY_API_SECRET };
  delete process.env.CLOUDINARY_CLOUD_NAME; delete process.env.CLOUDINARY_API_KEY; delete process.env.CLOUDINARY_API_SECRET;
  try {
    assert.equal((await call("POST", "/admin/uploads/sign", {})).status, 503);
    process.env.CLOUDINARY_URL = `cloudinary://${KEY}:${SECRET}@url-cloud`;
    const d = (await call("POST", "/admin/uploads/sign", {})).body.data;
    assert.deepEqual([d.cloudName, d.apiKey], ["url-cloud", KEY]);
    assert.equal(d.signature, cloudinary.utils.api_sign_request({ allowed_formats: d.allowedFormats, folder: d.folder, timestamp: d.timestamp }, SECRET));
  } finally {
    delete process.env.CLOUDINARY_URL;
    Object.assign(process.env, { CLOUDINARY_CLOUD_NAME: keep.n, CLOUDINARY_API_KEY: keep.k, CLOUDINARY_API_SECRET: keep.s });
  }
});

test("only images from OUR library may claim a public_id; plain URLs still work", async () => {
  const p = await product();
  const add = (body: object) => call("POST", `/products/${p.id}/images`, body);
  assert.equal((await add({ ...asset("a"), publicId: "someone-else/folder/a" })).status, 400); // outside our folder
  assert.equal((await add({ url: "https://res.cloudinary.com/other-cloud/image/upload/v1/shopeasy/products/a.jpg", publicId: "shopeasy/products/a" })).status, 400); // someone else's cloud
  assert.equal((await add({ url: "https://evil.example.com/a.jpg", publicId: "shopeasy/products/a" })).status, 400); // not Cloudinary at all
  assert.equal((await add({ url: "not a url", publicId: "shopeasy/products/a" })).status, 400);

  const ok = await add(asset("good"));
  assert.equal(ok.status, 201);
  assert.equal((await pool.query(`SELECT public_id FROM product_images WHERE id = $1`, [ok.body.data.id])).rows[0].public_id, "shopeasy/products/good");
  assert.equal((await add({ url: "https://cdn.dummyjson.com/x.webp" })).status, 201); // pasted/imported URLs keep working
});

test("a new product can be created with uploaded images (kept in order, public ids stored)", async () => {
  const p = await product([asset("one"), asset("two"), { url: "https://cdn.dummyjson.com/three.webp" }]);
  const rows = (await pool.query(`SELECT url, position, public_id FROM product_images WHERE product_id = $1 ORDER BY position`, [p.id])).rows;
  assert.deepEqual(rows.map((r) => [r.position, r.public_id]), [[0, "shopeasy/products/one"], [1, "shopeasy/products/two"], [2, null]]);
  const bad = await call("POST", "/products", { sku: `${tag}-bad`, name: "x", price: 1, images: [{ url: "https://evil.example.com/a.jpg", publicId: "shopeasy/products/a" }] });
  assert.equal(bad.status, 400);
  assert.equal((await pool.query(`SELECT count(*) FROM products WHERE sku = $1`, [`${tag}-bad`])).rows[0].count, "0"); // nothing half-created
});

test("deleting an image also deletes the stored file, and a failed remote delete never fails the request", async () => {
  const p = await product([asset("del1"), { url: "https://cdn.dummyjson.com/plain.webp" }]);
  const detail = (await call("GET", `/products/${p.id}`, undefined, "")).body.data;
  const [withId, plain] = detail.images;

  destroyed.length = 0;
  assert.equal((await call("DELETE", `/products/${p.id}/images/${plain.id}`)).status, 204);
  assert.equal(destroyed.length, 0); // nothing stored remotely for a pasted URL
  assert.equal((await call("DELETE", `/products/${p.id}/images/${withId.id}`)).status, 204);
  assert.deepEqual(destroyed, ["shopeasy/products/del1"]);

  const q = await product([asset("del2")]);
  const img = (await call("GET", `/products/${q.id}`, undefined, "")).body.data.images[0];
  setDestroyerForTests(async () => { throw new Error("cloudinary is down"); });
  assert.equal((await call("DELETE", `/products/${q.id}/images/${img.id}`)).status, 204); // the row is gone; only an orphan remains
  assert.equal((await pool.query(`SELECT count(*) FROM product_images WHERE product_id = $1`, [q.id])).rows[0].count, "0");
  setDestroyerForTests(async (id) => { destroyed.push(id); });
});

test("discarding an unsaved upload: admin only, and only inside our folder", async () => {
  destroyed.length = 0;
  assert.equal((await call("POST", "/admin/uploads/discard", { publicId: "shopeasy/products/x" }, tk.user)).status, 403);
  assert.equal((await call("POST", "/admin/uploads/discard", { publicId: "other-folder/secret" })).status, 400); // can't be used to delete arbitrary assets
  assert.equal((await call("POST", "/admin/uploads/discard", { publicId: "shopeasy/products/x" })).status, 204);
  assert.deepEqual(destroyed, ["shopeasy/products/x"]);
});
