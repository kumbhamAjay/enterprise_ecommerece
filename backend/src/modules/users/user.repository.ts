import type { Db } from "../auth/auth.repository";
import type { AddressInput } from "./user.types";

const ADDR = `id, address_line1 AS "addressLine1", city, state, postal_code AS "postalCode", country, is_default AS "isDefault"`;

export async function updateProfile(db: Db, id: string, p: { firstName?: string; lastName?: string }) {
  const { rows } = await db.query(
    `UPDATE users SET first_name = COALESCE($2, first_name), last_name = COALESCE($3, last_name), updated_at = now()
     WHERE id = $1 RETURNING id, first_name AS "firstName", last_name AS "lastName", email`,
    [id, p.firstName ?? null, p.lastName ?? null],
  );
  return rows[0];
}

export async function getPasswordHash(db: Db, id: string): Promise<string | undefined> {
  const { rows } = await db.query(`SELECT password_hash AS "h" FROM users WHERE id = $1`, [id]);
  return rows[0]?.h;
}

export async function listAddresses(db: Db, userId: string) {
  const { rows } = await db.query(`SELECT ${ADDR} FROM addresses WHERE user_id = $1 ORDER BY is_default DESC, id`, [userId]);
  return rows;
}

export const clearDefault = (db: Db, userId: string) =>
  db.query(`UPDATE addresses SET is_default = false WHERE user_id = $1 AND is_default`, [userId]);

export async function insertAddress(db: Db, userId: string, a: AddressInput) {
  const { rows } = await db.query(
    `INSERT INTO addresses (user_id, address_line1, city, state, postal_code, country, is_default)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, false)) RETURNING ${ADDR}`,
    [userId, a.addressLine1, a.city, a.state ?? null, a.postalCode ?? null, a.country, a.isDefault ?? null],
  );
  return rows[0];
}

// WHERE user_id = $2 is the ownership check: users can only touch their own addresses.
export async function updateAddress(db: Db, id: string, userId: string, a: Partial<AddressInput>) {
  const { rows } = await db.query(
    `UPDATE addresses SET address_line1 = COALESCE($3, address_line1), city = COALESCE($4, city),
       state = COALESCE($5, state), postal_code = COALESCE($6, postal_code),
       country = COALESCE($7, country), is_default = COALESCE($8, is_default)
     WHERE id = $1 AND user_id = $2 RETURNING ${ADDR}`,
    [id, userId, a.addressLine1 ?? null, a.city ?? null, a.state ?? null, a.postalCode ?? null, a.country ?? null, a.isDefault ?? null],
  );
  return rows[0];
}

export async function deleteAddress(db: Db, id: string, userId: string) {
  const r = await db.query(`DELETE FROM addresses WHERE id = $1 AND user_id = $2`, [id, userId]);
  return (r.rowCount ?? 0) > 0;
}
