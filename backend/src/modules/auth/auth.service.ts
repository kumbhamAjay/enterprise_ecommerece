import bcrypt from "bcrypt";
import { createHash, randomBytes } from "crypto";
import { pool, withTransaction } from "../../config/db";
import { sendMail } from "../../utils/mailer";
import { revokeAccessTokens } from "../../utils/revocation";
import { HttpError } from "../../utils/httpError";
import { signAccessToken } from "../../utils/jwt";
import * as repo from "./auth.repository";
import { assignRole, insertUser } from "./auth.repository";
import type { LoginInput, RegisterInput, UserDTO } from "./auth.types";

const UNIQUE_VIOLATION = "23505";

export async function register(input: RegisterInput): Promise<UserDTO> {
  const passwordHash = await bcrypt.hash(input.password, 12);

  const client = await pool.connect(); // one connection = one transaction
  try {
    await client.query("BEGIN");
    const user = await insertUser(client, { ...input, passwordHash });
    await assignRole(client, user.id, "CUSTOMER");
    await client.query("COMMIT");
    sendVerification(user.id, user.email).catch(console.error); // best-effort, never fails registration
    return { ...user, role: "CUSTOMER" };
  } catch (err: any) {
    await client.query("ROLLBACK");
    // The UNIQUE(email) constraint is the race-free duplicate check.
    if (err.code === UNIQUE_VIOLATION) throw new HttpError(409, "Email already registered");
    throw err;
  } finally {
    client.release();
  }
}

// ---------------- login / refresh / logout ----------------
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Compared against when the email is unknown, so response time doesn't reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync("dummy-password", 12);

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

// Refresh token = random opaque string. Only its hash is stored, so a DB leak can't be replayed.
async function issueTokens(db: Parameters<typeof repo.insertRefreshToken>[0], user: { id: string; roles: string[] }) {
  const refreshToken = randomBytes(32).toString("hex");
  await repo.insertRefreshToken(db, user.id, sha256(refreshToken), new Date(Date.now() + REFRESH_TTL_MS));
  return { accessToken: signAccessToken({ sub: user.id, roles: user.roles }), refreshToken };
}

const publicUser = (u: any) => ({ id: u.id, firstName: u.firstName, lastName: u.lastName, email: u.email, emailVerified: u.emailVerified, roles: u.roles });

export async function login({ email, password }: LoginInput) {
  const user = await repo.findUserByEmail(pool, email);
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok || !user.isActive) throw new HttpError(401, "Invalid credentials"); // same message for all cases
  return { user: publicUser(user), ...(await issueTokens(pool, user)) };
}

export async function refresh(token: string) {
  const client = await pool.connect();
  let reuseDetected = false;
  let reusedBy = "";
  try {
    await client.query("BEGIN");
    const row = await repo.findRefreshTokenForUpdate(client, sha256(token));
    if (!row) throw new HttpError(401, "Invalid refresh token");

    if (row.revokedAt) {
      // An already-used token came back: it was stolen (or replayed). Kill every session of this user.
      await repo.revokeAllForUser(client, row.userId);
      reuseDetected = true;
      reusedBy = row.userId;
    } else if (row.expiresAt < new Date()) {
      throw new HttpError(401, "Refresh token expired");
    } else {
      const user = await repo.findUserById(client, row.userId);
      if (!user?.isActive) throw new HttpError(401, "Account disabled");
      await repo.revokeToken(client, row.id); // rotation: old token is single-use
      const tokens = await issueTokens(client, user);
      await client.query("COMMIT");
      return tokens;
    }
    await client.query("COMMIT"); // commit (not rollback!) so the mass-revoke persists
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  if (reuseDetected) {
    await revokeAccessTokens(reusedBy); // a stolen token family: kill the access tokens too
    throw new HttpError(401, "Refresh token reuse detected");
  }
  throw new HttpError(401, "Invalid refresh token");
}

export async function logout(token: string) {
  await repo.revokeByHash(pool, sha256(token)); // idempotent
}

export async function me(userId: string) {
  const user = await repo.findUserById(pool, userId);
  if (!user) throw new HttpError(404, "User not found");
  return publicUser(user);
}

// ---------------- email verification / password reset ----------------
const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const HOUR = 60 * 60 * 1000;

// Emailed token is random; only its hash is stored. Issuing a new one voids older unused ones.
async function createToken(userId: string, type: repo.TokenType, ttlMs: number) {
  const raw = randomBytes(32).toString("hex");
  await repo.replaceOneTimeToken(pool, userId, type, sha256(raw), new Date(Date.now() + ttlMs));
  return raw;
}

// Single-use: validates, marks used, returns the owner. Runs inside the caller's transaction.
async function consumeToken(db: repo.Db, token: string, type: repo.TokenType): Promise<string> {
  const row = await repo.findOneTimeTokenForUpdate(db, sha256(token), type);
  if (!row || row.usedAt || row.expiresAt < new Date()) throw new HttpError(400, "Invalid or expired token");
  await repo.markTokenUsed(db, row.id);
  return row.userId;
}

export async function sendVerification(userId: string, email: string) {
  const t = await createToken(userId, "EMAIL_VERIFY", 24 * HOUR);
  await sendMail({ to: email, subject: "Verify your email", text: `${APP_URL}/verify-email?token=${t}` });
}

export async function resendVerification(userId: string) {
  const user = await repo.findUserById(pool, userId);
  if (!user) throw new HttpError(404, "User not found");
  if (user.emailVerified) throw new HttpError(409, "Email already verified");
  await sendVerification(user.id, user.email);
}

export async function verifyEmail(token: string) {
  await withTransaction(async (db) => repo.setEmailVerified(db, await consumeToken(db, token, "EMAIL_VERIFY")));
}

// Always succeeds from the caller's view, so it can't be used to discover registered emails.
export async function forgotPassword(email: string) {
  const user = await repo.findUserByEmail(pool, email);
  if (!user?.isActive) return;
  const t = await createToken(user.id, "PASSWORD_RESET", HOUR);
  await sendMail({ to: user.email, subject: "Reset your password", text: `${APP_URL}/reset-password?token=${t}` });
}

export async function resetPassword(token: string, newPassword: string) {
  const hash = await bcrypt.hash(newPassword, 12);
  let userId = "";
  await withTransaction(async (db) => {
    userId = await consumeToken(db, token, "PASSWORD_RESET");
    await repo.setPasswordHash(db, userId, hash);
    await repo.revokeAllForUser(db, userId); // a reset logs out every session
  });
  await revokeAccessTokens(userId); // ...and short-lived access tokens stop working right now
}
