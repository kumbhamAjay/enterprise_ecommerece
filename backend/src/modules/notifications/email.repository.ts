import type { Db } from "../auth/auth.repository";
import { SECRET_TEMPLATES } from "./email.templates";

export type EmailRow = { id: string; dedupeKey: string; template: string; toEmail: string; payload: any; priority: number; status: "PENDING" | "SENT" | "FAILED"; attempts: number; lastError: string | null };
const COLS = `id, dedupe_key AS "dedupeKey", template, to_email AS "toEmail", payload, priority, status, attempts, last_error AS "lastError"`;

// UNIQUE(dedupe_key): recording the same email twice (retries, duplicate events, double clicks) is a no-op.
export async function record(db: Db, e: { dedupeKey: string; template: string; to: string; payload: object; priority: number }): Promise<void> {
  await db.query(`INSERT INTO email_log (dedupe_key, template, to_email, payload, priority) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (dedupe_key) DO NOTHING`, [e.dedupeKey, e.template, e.to, JSON.stringify(e.payload), e.priority]);
}

export const get = async (db: Db, id: string): Promise<EmailRow | undefined> =>
  (await db.query(`SELECT ${COLS} FROM email_log WHERE id = $1`, [id])).rows[0];

// FOR UPDATE SKIP LOCKED: if another worker is already sending this very email, we get nothing back and simply skip it.
export const getForUpdate = async (db: Db, id: string): Promise<EmailRow | undefined> =>
  (await db.query(`SELECT ${COLS} FROM email_log WHERE id = $1 FOR UPDATE SKIP LOCKED`, [id])).rows[0];

// Hand rows to the queue: claim = stamp enqueued_at. Rows stuck 'enqueued' for 2+ minutes (lost job, crashed worker) become claimable again.
export async function claimBatch(db: Db, limit: number): Promise<{ id: string; priority: number }[]> {
  return (
    await db.query(
      `UPDATE email_log SET enqueued_at = now()
       WHERE id IN (SELECT id FROM email_log WHERE status = 'PENDING' AND (enqueued_at IS NULL OR enqueued_at < now() - interval '2 minutes')
                    ORDER BY priority, id LIMIT $1 FOR UPDATE SKIP LOCKED)
       RETURNING id, priority`,
      [limit],
    )
  ).rows;
}
export const unclaim = (db: Db, ids: string[]) => db.query(`UPDATE email_log SET enqueued_at = NULL WHERE id = ANY($1::bigint[])`, [ids]);

export const markSent = (db: Db, id: string, providerId: string | null) =>
  db.query(
    `UPDATE email_log SET status = 'SENT', sent_at = now(), attempts = attempts + 1, provider_id = $2, last_error = NULL,
       payload = CASE WHEN template = ANY($3) THEN '{}'::jsonb ELSE payload END   -- a sent password-reset link must not linger in the database
     WHERE id = $1`,
    [id, providerId, SECRET_TEMPLATES],
  );
export const markAttempt = (db: Db, id: string, error: string, final: boolean) =>
  db.query(`UPDATE email_log SET attempts = attempts + 1, last_error = $2, status = CASE WHEN $3 THEN 'FAILED' ELSE status END WHERE id = $1`, [id, error, final]);

// Admin retry of a dead email: back to PENDING with a fresh budget.
export const reset = async (db: Db, id: string): Promise<boolean> =>
  ((await db.query(`UPDATE email_log SET status = 'PENDING', attempts = 0, last_error = NULL, enqueued_at = NULL WHERE id = $1 AND status = 'FAILED'`, [id])).rowCount ?? 0) > 0;

export async function list(db: Db, q: { status?: string; page: number; limit: number }) {
  const { rows } = await db.query(
    `SELECT id, template, to_email AS "to", status, attempts, last_error AS "lastError", priority, created_at AS "createdAt", sent_at AS "sentAt", COUNT(*) OVER() AS total
     FROM email_log WHERE ($1::text IS NULL OR status = $1) ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
    [q.status ?? null, q.limit, (q.page - 1) * q.limit],
  );
  return { items: rows.map(({ total, ...r }) => r), total: rows[0] ? Number(rows[0].total) : 0 };
}
export const counts = async (db: Db) =>
  Object.fromEntries((await db.query(`SELECT status, count(*)::int AS n FROM email_log GROUP BY status`)).rows.map((r) => [r.status, r.n])) as Record<string, number>;
