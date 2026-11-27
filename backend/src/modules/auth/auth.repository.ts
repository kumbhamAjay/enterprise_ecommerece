import type { Pool, PoolClient } from "pg";
import type { UserDTO } from "./auth.types";

// Takes a client (not the pool) so the service controls the transaction.
export async function insertUser(
  db: PoolClient,
  u: { firstName: string; lastName?: string; email: string; passwordHash: string },
): Promise<Omit<UserDTO, "role">> {
  const { rows } = await db.query(
    `INSERT INTO users (first_name, last_name, email, password_hash)
     VALUES ($1, $2, $3, $4)
     RETURNING id, first_name AS "firstName", last_name AS "lastName", email`,
    [u.firstName, u.lastName ?? null, u.email, u.passwordHash],
  );
  return rows[0];
}

export async function assignRole(db: PoolClient, userId: string, role: string) {
  await db.query(
    `INSERT INTO user_roles (user_id, role_id)
     SELECT $1, id FROM roles WHERE name = $2`,
    [userId, role],
  );
}

// ---- login / refresh ----
export type Db = Pool | PoolClient;

const USER_WITH_ROLES = `
  SELECT u.id, u.first_name AS "firstName", u.last_name AS "lastName", u.email,
         u.password_hash AS "passwordHash", u.is_active AS "isActive",
         u.email_verified_at IS NOT NULL AS "emailVerified",
         COALESCE(array_remove(array_agg(r.name), NULL), '{}') AS roles
  FROM users u
  LEFT JOIN user_roles ur ON ur.user_id = u.id
  LEFT JOIN roles r ON r.id = ur.role_id`;

export async function findUserByEmail(db: Db, email: string) {
  const { rows } = await db.query(`${USER_WITH_ROLES} WHERE u.email = $1 GROUP BY u.id`, [email]);
  return rows[0];
}

export async function findUserById(db: Db, id: string) {
  const { rows } = await db.query(`${USER_WITH_ROLES} WHERE u.id = $1 GROUP BY u.id`, [id]);
  return rows[0];
}

export async function insertRefreshToken(db: Db, userId: string, tokenHash: string, expiresAt: Date) {
  await db.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt],
  );
}

// FOR UPDATE locks the row: two concurrent refreshes with the same token are serialized.
export async function findRefreshTokenForUpdate(db: Db, tokenHash: string) {
  const { rows } = await db.query(
    `SELECT id, user_id AS "userId", expires_at AS "expiresAt", revoked_at AS "revokedAt"
     FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
    [tokenHash],
  );
  return rows[0];
}

export const revokeToken = (db: Db, id: string) =>
  db.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1`, [id]);

export const revokeByHash = (db: Db, tokenHash: string) =>
  db.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`, [tokenHash]);

export const revokeAllForUser = (db: Db, userId: string) =>
  db.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);

// ---- one-time tokens (email verification / password reset) ----
export type TokenType = "EMAIL_VERIFY" | "PASSWORD_RESET";

export async function replaceOneTimeToken(db: Db, userId: string, type: TokenType, tokenHash: string, expiresAt: Date) {
  await db.query(`UPDATE one_time_tokens SET used_at = now() WHERE user_id = $1 AND type = $2 AND used_at IS NULL`, [userId, type]);
  await db.query(
    `INSERT INTO one_time_tokens (user_id, type, token_hash, expires_at) VALUES ($1, $2, $3, $4)`,
    [userId, type, tokenHash, expiresAt],
  );
}

export async function findOneTimeTokenForUpdate(db: Db, tokenHash: string, type: TokenType) {
  const { rows } = await db.query(
    `SELECT id, user_id AS "userId", expires_at AS "expiresAt", used_at AS "usedAt"
     FROM one_time_tokens WHERE token_hash = $1 AND type = $2 FOR UPDATE`,
    [tokenHash, type],
  );
  return rows[0];
}

export const markTokenUsed = (db: Db, id: string) =>
  db.query(`UPDATE one_time_tokens SET used_at = now() WHERE id = $1`, [id]);

export const setEmailVerified = (db: Db, userId: string) =>
  db.query(`UPDATE users SET email_verified_at = now(), updated_at = now() WHERE id = $1`, [userId]);

export const setPasswordHash = (db: Db, userId: string, hash: string) =>
  db.query(`UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1`, [userId, hash]);
