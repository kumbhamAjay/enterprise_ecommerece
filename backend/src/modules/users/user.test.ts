import "dotenv/config";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import app from "../../app";
import { pool } from "../../config/db";

const email = `test_${crypto.randomUUID()}@example.com`;
const password = "password123";
let server: Server, base: string, token: string;

const call = async (method: string, path: string, body?: object, tk = token) => {
  const r = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", ...(tk && { authorization: `Bearer ${tk}` }) },
    body: body && JSON.stringify(body),
  });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
};

before(async () => {
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  await call("POST", "/auth/register", { firstName: "T", email, password }, "");
  token = (await call("POST", "/auth/login", { email, password }, "")).body.data.accessToken;
});

after(async () => {
  await pool.query("DELETE FROM addresses WHERE user_id = (SELECT id FROM users WHERE email = $1)", [email]); // FK has no cascade
  await pool.query("DELETE FROM users WHERE email = $1", [email]);
  server.close();
  await pool.end();
});

test("requires auth", async () => {
  assert.equal((await call("GET", "/users/me/addresses", undefined, "")).status, 401);
});

test("profile update", async () => {
  const r = await call("PATCH", "/users/me", { firstName: "Renamed", lastName: "User" });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.firstName, "Renamed");
  assert.equal((await call("PATCH", "/users/me", { firstName: "" })).status, 400);
});

test("addresses: CRUD, single default, ownership", async () => {
  const a = (await call("POST", "/users/me/addresses", { addressLine1: "1 A St", city: "X", country: "IN", isDefault: true })).body.data;
  const b = (await call("POST", "/users/me/addresses", { addressLine1: "2 B St", city: "Y", country: "IN", isDefault: true })).body.data;
  const list = (await call("GET", "/users/me/addresses")).body.data;
  assert.equal(list.length, 2);
  assert.deepEqual(list.filter((x: any) => x.isDefault).map((x: any) => x.id), [b.id]); // new default replaced old

  assert.equal((await call("PATCH", `/users/me/addresses/${a.id}`, { city: "Z" })).body.data.city, "Z");
  assert.equal((await call("PATCH", "/users/me/addresses/999999999", { city: "Z" })).status, 404);
  assert.equal((await call("PATCH", "/users/me/addresses/abc", { city: "Z" })).status, 400);
  assert.equal((await call("DELETE", `/users/me/addresses/${a.id}`)).status, 204);
  assert.equal((await call("DELETE", `/users/me/addresses/${a.id}`)).status, 404);
});

test("change password revokes sessions", async () => {
  assert.equal((await call("POST", "/users/me/password", { currentPassword: "wrong-one", newPassword: "newpassword456" })).status, 400);
  assert.equal((await call("POST", "/users/me/password", { currentPassword: password, newPassword: "newpassword456" })).status, 200);
  assert.equal((await call("POST", "/auth/login", { email, password }, "")).status, 401);
  assert.equal((await call("POST", "/auth/login", { email, password: "newpassword456" }, "")).status, 200);
});
