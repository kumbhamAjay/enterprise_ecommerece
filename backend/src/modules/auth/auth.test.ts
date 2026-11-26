import "dotenv/config";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import app from "../../app";
import { pool } from "../../config/db";
import { outbox } from "../../utils/mailer";

// Integration test: hits the real DB, cleans up its own user.
const email = `test_${crypto.randomUUID()}@example.com`;
const password = "password123";
let server: Server;
let base: string;

const call = async (path: string, body?: object, token?: string) => {
  const r = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", ...(token && { authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
};

before(async () => {
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as any).port}/api/auth`;
});

after(async () => {
  await pool.query("DELETE FROM users WHERE email = $1", [email]);
  server.close();
  await pool.end();
});

test("register: validates, creates CUSTOMER, rejects duplicate", async () => {
  assert.equal((await call("/register", { firstName: "", email: "bad", password: "x" })).status, 400);
  const ok = await call("/register", { firstName: "T", email, password });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.data.role, "CUSTOMER");
  assert.equal("passwordHash" in ok.body.data, false);
  assert.equal((await call("/register", { firstName: "T", email, password })).status, 409);
});

test("login + me + refresh rotation + reuse detection + logout", async () => {
  assert.equal((await call("/login", { email, password: "wrongpass1" })).status, 401);
  assert.equal((await call("/login", { email: "nobody@example.com", password })).status, 401);

  const login = await call("/login", { email, password });
  assert.equal(login.status, 200);
  const { accessToken, refreshToken: r1 } = login.body.data;

  assert.equal((await call("/me")).status, 401);
  assert.equal((await call("/me", undefined, accessToken + "x")).status, 401);
  assert.deepEqual((await call("/me", undefined, accessToken)).body.data.roles, ["CUSTOMER"]);

  const rotated = await call("/refresh", { refreshToken: r1 });
  assert.equal(rotated.status, 200);
  const r2 = rotated.body.data.refreshToken;

  assert.equal((await call("/refresh", { refreshToken: r1 })).status, 401); // reuse
  assert.equal((await call("/refresh", { refreshToken: r2 })).status, 401); // whole family revoked

  const again = await call("/login", { email, password });
  assert.equal((await call("/logout", { refreshToken: again.body.data.refreshToken })).status, 204);
  assert.equal((await call("/refresh", { refreshToken: again.body.data.refreshToken })).status, 401);
});

const tokenFromLastMail = () => outbox.at(-1)!.text.match(/token=(\w+)/)![1];

test("email verification: single-use token", async () => {
  const l = await call("/login", { email, password });
  const { accessToken } = l.body.data;
  assert.equal((await call("/me", undefined, accessToken)).body.data.emailVerified, false);

  assert.equal((await call("/resend-verification", {}, accessToken)).status, 200);
  const token = tokenFromLastMail();
  assert.equal((await call("/verify-email", { token: "bogus" })).status, 400);
  assert.equal((await call("/verify-email", { token })).status, 200);
  assert.equal((await call("/verify-email", { token })).status, 400); // already used
  assert.equal((await call("/me", undefined, accessToken)).body.data.emailVerified, true);
  assert.equal((await call("/resend-verification", {}, accessToken)).status, 409);
});

test("password reset: generic response, single-use, revokes sessions", async () => {
  const unknown = await call("/forgot-password", { email: "nobody@example.com" });
  const known = await call("/forgot-password", { email });
  assert.deepEqual(unknown.body, known.body); // can't enumerate emails

  const token = tokenFromLastMail();
  const { refreshToken } = (await call("/login", { email, password })).body.data;

  assert.equal((await call("/reset-password", { token, password: "newpassword456" })).status, 200);
  assert.equal((await call("/reset-password", { token, password: "another12345" })).status, 400);
  assert.equal((await call("/refresh", { refreshToken })).status, 401); // old session dead
  assert.equal((await call("/login", { email, password })).status, 401);
  assert.equal((await call("/login", { email, password: "newpassword456" })).status, 200);
});
