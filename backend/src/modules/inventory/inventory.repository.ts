import type { Db } from "../auth/auth.repository";
import type { ListQuery, TxnType } from "./inventory.types";

export type Stock = { onHand: number; reserved: number; threshold: number };
const STOCK = `RETURNING quantity_on_hand AS "onHand", reserved_quantity AS reserved, low_stock_threshold AS threshold`;

// ---------------------------------------------------------------------------------------------
// The anti-oversell core. Each of these is ONE atomic statement: Postgres takes the row lock, and
// a concurrent UPDATE on the same row waits, then re-checks the WHERE against the committed
// result (READ COMMITTED). So "check availability" and "take it" can never be separated.
// ---------------------------------------------------------------------------------------------
export async function reserveUnits(db: Db, productId: string, qty: number): Promise<Stock | undefined> {
  const { rows } = await db.query(
    `UPDATE inventory i SET reserved_quantity = i.reserved_quantity + $2, updated_at = now()
     FROM products p
     WHERE i.product_id = $1 AND p.id = i.product_id AND p.is_active
       AND i.quantity_on_hand - i.reserved_quantity >= $2
     RETURNING i.quantity_on_hand AS "onHand", i.reserved_quantity AS reserved, i.low_stock_threshold AS threshold`,
    [productId, qty],
  );
  return rows[0];
}

export async function releaseUnits(db: Db, productId: string, qty: number): Promise<Stock> {
  return (await db.query(`UPDATE inventory SET reserved_quantity = reserved_quantity - $2, updated_at = now() WHERE product_id = $1 ${STOCK}`, [productId, qty])).rows[0];
}

// A sale: the units leave the building (on_hand) and stop being held (reserved). `available` is unchanged.
export async function confirmUnits(db: Db, productId: string, qty: number): Promise<Stock> {
  return (
    await db.query(
      `UPDATE inventory SET quantity_on_hand = quantity_on_hand - $2, reserved_quantity = reserved_quantity - $2, updated_at = now() WHERE product_id = $1 ${STOCK}`,
      [productId, qty],
    )
  ).rows[0];
}

// Admin delta. Never lets on_hand drop below what is already reserved for customers.
export async function adjustOnHand(db: Db, productId: string, delta: number): Promise<Stock | undefined> {
  return (
    await db.query(
      `UPDATE inventory SET quantity_on_hand = quantity_on_hand + $2, updated_at = now()
       WHERE product_id = $1 AND quantity_on_hand + $2 >= reserved_quantity ${STOCK}`,
      [productId, delta],
    )
  ).rows[0];
}

// Pessimistic locking: read-modify-write where the new value depends on the old one (stocktake).
export async function lockStock(db: Db, productId: string): Promise<Stock | undefined> {
  return (
    await db.query(
      `SELECT quantity_on_hand AS "onHand", reserved_quantity AS reserved, low_stock_threshold AS threshold FROM inventory WHERE product_id = $1 FOR UPDATE`,
      [productId],
    )
  ).rows[0];
}
export async function setOnHand(db: Db, productId: string, qty: number): Promise<Stock> {
  return (await db.query(`UPDATE inventory SET quantity_on_hand = $2, updated_at = now() WHERE product_id = $1 ${STOCK}`, [productId, qty])).rows[0];
}
export async function setThreshold(db: Db, productId: string, t: number): Promise<Stock | undefined> {
  return (await db.query(`UPDATE inventory SET low_stock_threshold = $2, updated_at = now() WHERE product_id = $1 ${STOCK}`, [productId, t])).rows[0];
}

// ---- ledger ----
export type Txn = { productId: string; type: TxnType; quantityDelta?: number; reservedDelta?: number; onHandAfter: number; reservedAfter: number; reservationId?: string; actorId?: string | null; note?: string };
export const logTxn = (db: Db, t: Txn) =>
  db.query(
    `INSERT INTO inventory_transactions (product_id, type, quantity_delta, reserved_delta, on_hand_after, reserved_after, reservation_id, actor_user_id, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [t.productId, t.type, t.quantityDelta ?? 0, t.reservedDelta ?? 0, t.onHandAfter, t.reservedAfter, t.reservationId ?? null, t.actorId ?? null, t.note ?? null],
  );

export async function createInitial(db: Db, productId: string, qty: number, actorId?: string | null) {
  await db.query(`INSERT INTO inventory (product_id, quantity_on_hand) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [productId, qty]);
  if (qty > 0) await logTxn(db, { productId, type: "INITIAL", quantityDelta: qty, onHandAfter: qty, reservedAfter: 0, actorId, note: "Initial stock" });
}

// Bulk version for imports: rows that already exist keep their stock (a re-import never overwrites real counts).
export async function createInitialBulk(db: Db, productIds: string[], quantities: number[]) {
  await db.query(
    `WITH ins AS (
       INSERT INTO inventory (product_id, quantity_on_hand)
       SELECT * FROM unnest($1::bigint[], $2::int[]) ON CONFLICT DO NOTHING
       RETURNING product_id, quantity_on_hand)
     INSERT INTO inventory_transactions (product_id, type, quantity_delta, on_hand_after, reserved_after, note)
     SELECT product_id, 'INITIAL', quantity_on_hand, quantity_on_hand, 0, 'Imported' FROM ins WHERE quantity_on_hand > 0`,
    [productIds, quantities],
  );
}

// ---- reservations ----
export type Reservation = { id: string; productId: string; userId: string | null; quantity: number; status: string; expiresAt: Date };
const RES = `id, product_id AS "productId", user_id AS "userId", quantity, status, expires_at AS "expiresAt"`;

export async function insertReservation(db: Db, r: { productId: string; userId: string; quantity: number; expiresAt: Date }): Promise<Reservation> {
  return (
    await db.query(`INSERT INTO stock_reservations (product_id, user_id, quantity, expires_at) VALUES ($1, $2, $3, $4) RETURNING ${RES}`, [r.productId, r.userId, r.quantity, r.expiresAt])
  ).rows[0];
}
export const findReservation = async (db: Db, id: string): Promise<Reservation | undefined> =>
  (await db.query(`SELECT ${RES} FROM stock_reservations WHERE id = $1`, [id])).rows[0];

// ACTIVE -> final state, atomically. Only ONE concurrent caller gets a row back, which makes
// release / confirm / expire idempotent: whoever loses simply finds nothing to do.
export async function resolveReservation(db: Db, id: string, status: "CONFIRMED" | "RELEASED" | "EXPIRED"): Promise<Reservation | undefined> {
  return (await db.query(`UPDATE stock_reservations SET status = $2, resolved_at = now() WHERE id = $1 AND status = 'ACTIVE' RETURNING ${RES}`, [id, status])).rows[0];
}

// SKIP LOCKED: several sweepers can run side by side without blocking or double-processing a row.
export async function lockExpired(db: Db, limit: number): Promise<{ id: string }[]> {
  return (
    await db.query(
      `SELECT id FROM stock_reservations WHERE status = 'ACTIVE' AND expires_at <= now() ORDER BY product_id, id LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [limit],
    )
  ).rows;
}

// ---- reads ----
const VIEW = `p.id AS "productId", p.sku, p.name, p.is_active AS "isActive",
  i.quantity_on_hand AS "quantityOnHand", i.reserved_quantity AS reserved,
  i.quantity_on_hand - i.reserved_quantity AS available, i.low_stock_threshold AS "lowStockThreshold", i.updated_at AS "updatedAt"`;

export async function listInventory(db: Db, q: ListQuery) {
  const params: unknown[] = [];
  const add = (v: unknown) => (params.push(v), `$${params.length}`);
  const where = ["TRUE"];
  if (q.q) where.push(`(p.search_vector @@ websearch_to_tsquery('english', ${add(q.q)}) OR p.sku ILIKE ${add(`%${q.q}%`)})`);
  if (q.lowStock) where.push(`p.is_active AND i.quantity_on_hand - i.reserved_quantity <= i.low_stock_threshold`);
  const limit = add(q.limit);
  const offset = add((q.page - 1) * q.limit);
  const { rows } = await db.query(
    `SELECT ${VIEW}, COUNT(*) OVER() AS total FROM inventory i JOIN products p ON p.id = i.product_id
     WHERE ${where.join(" AND ")} ORDER BY i.quantity_on_hand - i.reserved_quantity, p.name LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return { items: rows.map(({ total, ...r }) => r), total: rows[0] ? Number(rows[0].total) : 0 };
}

export const getInventory = async (db: Db, productId: string) =>
  (await db.query(`SELECT ${VIEW} FROM inventory i JOIN products p ON p.id = i.product_id WHERE i.product_id = $1`, [productId])).rows[0];

export async function availability(db: Db, productId: string): Promise<number | undefined> {
  const { rows } = await db.query(
    `SELECT i.quantity_on_hand - i.reserved_quantity AS available FROM inventory i JOIN products p ON p.id = i.product_id WHERE i.product_id = $1 AND p.is_active`,
    [productId],
  );
  return rows[0]?.available;
}

export async function history(db: Db, productId: string, page: number, limit: number) {
  const { rows } = await db.query(
    `SELECT t.id, t.type, t.quantity_delta AS "quantityDelta", t.reserved_delta AS "reservedDelta", t.on_hand_after AS "onHandAfter",
            t.reserved_after AS "reservedAfter", t.reservation_id AS "reservationId", t.note, t.created_at AS "createdAt",
            CASE WHEN u.id IS NULL THEN NULL ELSE u.first_name END AS "actorName", COUNT(*) OVER() AS total
     FROM inventory_transactions t LEFT JOIN users u ON u.id = t.actor_user_id
     WHERE t.product_id = $1 ORDER BY t.created_at DESC, t.id DESC LIMIT $2 OFFSET $3`,
    [productId, limit, (page - 1) * limit],
  );
  return { items: rows.map(({ total, ...r }) => r), total: rows[0] ? Number(rows[0].total) : 0 };
}

export async function productLabel(db: Db, productId: string): Promise<{ sku: string; name: string } | undefined> {
  return (await db.query(`SELECT sku, name FROM products WHERE id = $1`, [productId])).rows[0];
}

export async function adminEmails(db: Db): Promise<string[]> {
  const { rows } = await db.query(
    `SELECT DISTINCT u.email FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
     WHERE r.name IN ('ADMIN', 'SUPER_ADMIN') AND u.is_active`,
  );
  return rows.map((r) => r.email);
}
