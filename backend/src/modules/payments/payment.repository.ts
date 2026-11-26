import type { Db } from "../auth/auth.repository";

export type Payment = {
  id: string; orderId: string; intentId: string; attempt: number; amountCents: number; currency: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED" | "CANCELED"; appliedToOrder: boolean; refundedCents: number;
};
const COLS = `id, order_id AS "orderId", provider_intent_id AS "intentId", attempt, amount_cents AS "amountCents", currency, status,
  applied_to_order AS "appliedToOrder", refunded_cents AS "refundedCents"`;

export const latestPayment = async (db: Db, orderId: string): Promise<Payment | undefined> =>
  (await db.query(`SELECT ${COLS} FROM payments WHERE order_id = $1 ORDER BY id DESC LIMIT 1`, [orderId])).rows[0];

// FOR UPDATE: webhook, browser "sync" and the reconciler can all try to settle the same payment; the row lock makes them take turns.
export const paymentByIntent = async (db: Db, intentId: string): Promise<Payment | undefined> =>
  (await db.query(`SELECT ${COLS} FROM payments WHERE provider_intent_id = $1 FOR UPDATE`, [intentId])).rows[0];

export async function insertPayment(db: Db, p: { orderId: string; intentId: string; attempt: number; amountCents: number; currency: string }): Promise<void> {
  await db.query(
    `INSERT INTO payments (order_id, provider_intent_id, attempt, amount_cents, currency) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (provider_intent_id) DO NOTHING`,
    [p.orderId, p.intentId, p.attempt, p.amountCents, p.currency.toUpperCase()],
  );
}

export const setPaymentStatus = (db: Db, id: string, status: Payment["status"], opts: { applied?: boolean; error?: string | null } = {}) =>
  db.query(
    `UPDATE payments SET status = $2, applied_to_order = COALESCE($3, applied_to_order), last_error = $4, updated_at = now(),
       succeeded_at = CASE WHEN $2 = 'SUCCEEDED' THEN now() ELSE succeeded_at END
     WHERE id = $1`,
    [id, status, opts.applied ?? null, opts.error ?? null],
  );

// ---- webhook de-duplication ----
// A duplicate delivery BLOCKS here until the first one commits, then sees the conflict and does nothing.
export async function claimEvent(db: Db, id: string, type: string, objectId: string | null): Promise<boolean> {
  const r = await db.query(`INSERT INTO stripe_events (id, type, object_id) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`, [id, type, objectId]);
  return (r.rowCount ?? 0) > 0;
}

// ---- refund outbox ----
// Queue the refund inside the business transaction (UNIQUE(payment_id, reason) makes queueing idempotent).
export async function queueRefund(db: Db, payment: Pick<Payment, "id" | "orderId" | "amountCents" | "refundedCents">, reason: "ORDER_REFUND" | "LATE_PAYMENT") {
  const amount = payment.amountCents - payment.refundedCents;
  if (amount <= 0) return;
  await db.query(`INSERT INTO refunds (payment_id, order_id, amount_cents, reason) VALUES ($1, $2, $3, $4) ON CONFLICT (payment_id, reason) DO NOTHING`, [payment.id, payment.orderId, amount, reason]);
}

// An order is being refunded: queue a refund for whatever was actually paid for it (no-op if it was never paid by card).
export async function queueOrderRefund(db: Db, orderId: string) {
  const { rows } = await db.query(`SELECT ${COLS} FROM payments WHERE order_id = $1 AND status = 'SUCCEEDED' AND applied_to_order ORDER BY id DESC LIMIT 1`, [orderId]);
  if (rows[0]) await queueRefund(db, rows[0], "ORDER_REFUND");
}

export const MAX_REFUND_ATTEMPTS = 10;
export type RefundJob = { id: string; paymentId: string; amountCents: number; attempts: number; intentId: string };
// Claim = bump attempts. SKIP LOCKED lets several workers run side by side; Stripe's idempotency key covers a crash after the call.
export async function claimRefunds(db: Db, orderId?: string): Promise<RefundJob[]> {
  const { rows } = await db.query(
    `UPDATE refunds r SET attempts = r.attempts + 1, updated_at = now()
     FROM payments p
     WHERE p.id = r.payment_id AND r.id IN (
       SELECT id FROM refunds WHERE status = 'PENDING' AND attempts < $1 AND ($2::bigint IS NULL OR order_id = $2)
       ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED)
     RETURNING r.id, r.payment_id AS "paymentId", r.amount_cents AS "amountCents", r.attempts, p.provider_intent_id AS "intentId"`,
    [MAX_REFUND_ATTEMPTS, orderId ?? null],
  );
  return rows;
}
export const finishRefund = (db: Db, id: string, status: "SUCCEEDED" | "FAILED", providerId: string | null, error: string | null) =>
  db.query(`UPDATE refunds SET status = $2, provider_refund_id = COALESCE($3, provider_refund_id), last_error = $4, updated_at = now() WHERE id = $1`, [id, status, providerId, error]);
export const noteRefundError = (db: Db, id: string, error: string, giveUp: boolean) =>
  db.query(`UPDATE refunds SET last_error = $2, status = CASE WHEN $3 THEN 'FAILED' ELSE status END, updated_at = now() WHERE id = $1`, [id, error, giveUp]);

// refunded_cents follows our own succeeded refunds, and never goes below what Stripe reports (dashboard-initiated refunds)
export const syncRefunded = (db: Db, paymentId: string, stripeReported = 0) =>
  db.query(
    `UPDATE payments SET refunded_cents = LEAST(amount_cents, GREATEST(refunded_cents, $2, (SELECT COALESCE(SUM(amount_cents), 0) FROM refunds WHERE payment_id = $1 AND status = 'SUCCEEDED'))), updated_at = now() WHERE id = $1`,
    [paymentId, stripeReported],
  );

// ---- reconciliation ----
export const stalePayments = async (db: Db, olderThanSeconds: number, limit = 50) =>
  (await db.query(`SELECT ${COLS} FROM payments WHERE status IN ('PENDING', 'FAILED') AND created_at < now() - make_interval(secs => $1) ORDER BY id LIMIT $2`, [olderThanSeconds, limit])).rows as Payment[];
