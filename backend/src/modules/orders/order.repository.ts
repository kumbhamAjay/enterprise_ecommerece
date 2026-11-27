import type { Db } from "../auth/auth.repository";
import type { Address, ListQuery, OrderStatus } from "./order.types";

// ---- idempotency ----
// INSERT ... ON CONFLICT DO NOTHING inside the checkout transaction: a concurrent duplicate BLOCKS on the unique index
// until the first attempt commits (then it sees the conflict and replays) or rolls back (then it proceeds as a new attempt).
export async function claimKey(db: Db, userId: string, key: string, hash: string): Promise<boolean> {
  const r = await db.query(`INSERT INTO idempotency_keys (user_id, key, request_hash) VALUES ($1, $2, $3) ON CONFLICT (user_id, key) DO NOTHING`, [userId, key, hash]);
  return (r.rowCount ?? 0) > 0;
}
export async function getKey(db: Db, userId: string, key: string): Promise<{ requestHash: string; orderId: string | null } | undefined> {
  return (await db.query(`SELECT request_hash AS "requestHash", order_id AS "orderId" FROM idempotency_keys WHERE user_id = $1 AND key = $2`, [userId, key])).rows[0];
}
export const attachKey = (db: Db, userId: string, key: string, orderId: string) =>
  db.query(`UPDATE idempotency_keys SET order_id = $3 WHERE user_id = $1 AND key = $2`, [userId, key, orderId]);

// ---- checkout ----
export type CartLineRow = { productId: string; quantity: number; sku: string; name: string; price: string; active: boolean };
export async function cartLines(db: Db, cartId: string): Promise<CartLineRow[]> {
  return (
    await db.query(
      `SELECT ci.product_id AS "productId", ci.quantity, p.sku, p.name, p.price, p.is_active AS active
       FROM cart_items ci JOIN products p ON p.id = ci.product_id WHERE ci.cart_id = $1 ORDER BY p.id`,
      [cartId],
    )
  ).rows;
}

export async function insertOrder(
  db: Db,
  o: { number: string; userId: string; email: string; subtotal: string; shipping: string; tax: string; total: string; shippingAddress: Address; billingAddress: Address; paymentExpiresAt: Date },
): Promise<string | undefined> {
  const { rows } = await db.query(
    `INSERT INTO orders (order_number, user_id, customer_email, subtotal, shipping, tax, total, shipping_address, billing_address, payment_expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (order_number) DO NOTHING RETURNING id`,
    [o.number, o.userId, o.email, o.subtotal, o.shipping, o.tax, o.total, JSON.stringify(o.shippingAddress), JSON.stringify(o.billingAddress), o.paymentExpiresAt],
  );
  return rows[0]?.id;
}

export async function insertItems(db: Db, orderId: string, items: { productId: string; reservationId: string; sku: string; name: string; unitPrice: string; quantity: number; lineTotal: string }[]) {
  await db.query(
    `INSERT INTO order_items (order_id, product_id, reservation_id, sku, name, unit_price, quantity, line_total)
     SELECT $1, * FROM unnest($2::bigint[], $3::bigint[], $4::text[], $5::text[], $6::numeric[], $7::int[], $8::numeric[])`,
    [orderId, items.map((i) => i.productId), items.map((i) => i.reservationId), items.map((i) => i.sku), items.map((i) => i.name), items.map((i) => i.unitPrice), items.map((i) => i.quantity), items.map((i) => i.lineTotal)],
  );
}

export const logStatus = (db: Db, orderId: string, from: OrderStatus | null, to: OrderStatus, actorId: string | null, note?: string) =>
  db.query(`INSERT INTO order_status_history (order_id, from_status, to_status, actor_user_id, note) VALUES ($1, $2, $3, $4, $5)`, [orderId, from, to, actorId, note ?? null]);

// ---- state transitions ----
// FOR UPDATE: every transition of one order is serialized, so two simultaneous cancels/payments can't both act.
export async function lockOrder(db: Db, id: string) {
  return (
    await db.query(`SELECT id, user_id AS "userId", status, order_number AS "orderNumber" FROM orders WHERE id = $1 FOR UPDATE`, [id])
  ).rows[0] as { id: string; userId: string | null; status: OrderStatus; orderNumber: string } | undefined;
}

export const orderItemsForUpdate = async (db: Db, orderId: string) =>
  (
    await db.query(`SELECT product_id AS "productId", reservation_id AS "reservationId", quantity FROM order_items WHERE order_id = $1 ORDER BY product_id`, [orderId])
  ).rows as { productId: string | null; reservationId: string | null; quantity: number }[];

export async function setStatus(db: Db, id: string, to: OrderStatus, note?: string) {
  await db.query(
    `UPDATE orders SET status = $2, updated_at = now(),
       paid_at      = CASE WHEN $2 = 'PAID' THEN now() ELSE paid_at END,
       shipped_at   = CASE WHEN $2 = 'SHIPPED' THEN now() ELSE shipped_at END,
       delivered_at = CASE WHEN $2 = 'DELIVERED' THEN now() ELSE delivered_at END,
       cancelled_at = CASE WHEN $2 IN ('CANCELLED', 'REFUNDED') THEN now() ELSE cancelled_at END,
       cancel_reason = CASE WHEN $2 IN ('CANCELLED', 'REFUNDED') THEN $3 ELSE cancel_reason END
     WHERE id = $1`,
    [id, to, note ?? null],
  );
}

export async function lockExpired(db: Db, limit: number): Promise<{ id: string }[]> {
  return (await db.query(`SELECT id FROM orders WHERE status = 'PENDING_PAYMENT' AND payment_expires_at <= now() ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED`, [limit])).rows;
}

// ---- reads ----
const ORDER_COLS = `o.id, o.order_number AS "orderNumber", o.user_id AS "userId", o.customer_email AS "customerEmail", o.status,
  o.subtotal, o.shipping, o.tax, o.total, o.currency, o.shipping_address AS "shippingAddress", o.billing_address AS "billingAddress",
  o.payment_expires_at AS "paymentExpiresAt", o.placed_at AS "placedAt", o.paid_at AS "paidAt", o.shipped_at AS "shippedAt",
  o.delivered_at AS "deliveredAt", o.cancelled_at AS "cancelledAt", o.cancel_reason AS "cancelReason"`;

export async function getOrder(db: Db, id: string) {
  const { rows } = await db.query(
    `SELECT ${ORDER_COLS},
       COALESCE((SELECT json_agg(json_build_object('productId', i.product_id::text, 'sku', i.sku, 'name', i.name, 'unitPrice', i.unit_price::text,
                  'quantity', i.quantity, 'lineTotal', i.line_total::text,
                  'imageUrl', (SELECT url FROM product_images im WHERE im.product_id = i.product_id ORDER BY position, id LIMIT 1)) ORDER BY i.id)
                 FROM order_items i WHERE i.order_id = o.id), '[]') AS items,
       COALESCE((SELECT json_agg(json_build_object('fromStatus', h.from_status, 'toStatus', h.to_status, 'note', h.note, 'createdAt', h.created_at,
                  'actor', CASE WHEN u.id IS NULL THEN NULL ELSE u.first_name END) ORDER BY h.id)
                 FROM order_status_history h LEFT JOIN users u ON u.id = h.actor_user_id WHERE h.order_id = o.id), '[]') AS history,
       COALESCE((SELECT json_agg(json_build_object('status', p.status, 'amountCents', p.amount_cents, 'currency', p.currency,
                  'refundedCents', p.refunded_cents, 'appliedToOrder', p.applied_to_order, 'lastError', p.last_error, 'createdAt', p.created_at,
                  'refunds', COALESCE((SELECT json_agg(json_build_object('status', r.status, 'amountCents', r.amount_cents, 'reason', r.reason) ORDER BY r.id)
                                       FROM refunds r WHERE r.payment_id = p.id), '[]')) ORDER BY p.id)
                 FROM payments p WHERE p.order_id = o.id), '[]') AS payments
     FROM orders o WHERE o.id = $1`,
    [id],
  );
  return rows[0];
}

export async function listOrders(db: Db, q: ListQuery & { userId?: string }) {
  const params: unknown[] = [];
  const add = (v: unknown) => (params.push(v), `$${params.length}`);
  const where = ["TRUE"];
  if (q.userId) where.push(`o.user_id = ${add(q.userId)}`);
  if (q.status) where.push(`o.status = ${add(q.status)}`);
  if (q.q) where.push(`(o.order_number ILIKE ${add(`%${q.q}%`)} OR o.customer_email ILIKE ${add(`%${q.q}%`)})`);
  const limit = add(q.limit);
  const offset = add((q.page - 1) * q.limit);
  const { rows } = await db.query(
    `SELECT o.id, o.order_number AS "orderNumber", o.customer_email AS "customerEmail", o.status, o.total, o.currency, o.placed_at AS "placedAt",
            (SELECT COALESCE(SUM(quantity), 0)::int FROM order_items WHERE order_id = o.id) AS "itemCount",
            COALESCE((SELECT json_agg(t.url) FROM (
               SELECT (SELECT url FROM product_images im WHERE im.product_id = oi.product_id ORDER BY position, id LIMIT 1) AS url
               FROM order_items oi WHERE oi.order_id = o.id ORDER BY oi.id LIMIT 3) t WHERE t.url IS NOT NULL), '[]') AS thumbs,
            COUNT(*) OVER() AS total_rows
     FROM orders o WHERE ${where.join(" AND ")} ORDER BY o.placed_at DESC, o.id DESC LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return { items: rows.map(({ total_rows, ...r }) => r), total: rows[0] ? Number(rows[0].total_rows) : 0 };
}
