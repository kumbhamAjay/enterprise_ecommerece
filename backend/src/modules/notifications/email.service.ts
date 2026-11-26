import { UnrecoverableError } from "bullmq";
import { pool, withTransaction } from "../../config/db";
import { EMAIL_QUEUE, getQueue, queueReady, withTimeout } from "../../config/queue";
import { HttpError } from "../../utils/httpError";
import type { Db } from "../auth/auth.repository";
import * as orderRepo from "../orders/order.repository";
import { ProviderError, provider } from "./email.provider";
import * as repo from "./email.repository";
import { PRIORITY, render, type Template } from "./email.templates";

// "inline" sends immediately in-process (used by tests); "queue" hands the work to BullMQ workers.
export const emailMode = () => process.env.EMAIL_MODE ?? (process.env.NODE_ENV === "test" ? "inline" : "queue");
export const maxAttempts = () => Number(process.env.EMAIL_MAX_ATTEMPTS ?? 5);
export const backoffMs = () => Number(process.env.EMAIL_BACKOFF_MS ?? 5000); // 5s, 10s, 20s, 40s... (exponential)

export type EmailInput = { template: Template; to: string; payload: object; dedupeKey: string; priority?: number };

// 1) RECORD (outbox): a plain row. Pass the transaction client to make it atomic with the business change.
export const recordEmail = (db: Db, e: EmailInput) => repo.record(db, { ...e, priority: e.priority ?? PRIORITY[e.template] });

// Order-related emails: built from the order as the transaction sees it. dedupe key = template + order id, so each
// kind of order email exists at most once per order no matter how many times the transition code runs.
export async function recordOrderEmail(db: Db, orderId: string, template: Template, extra: Record<string, unknown> = {}) {
  const o = await orderRepo.getOrder(db, orderId);
  if (!o) return;
  await recordEmail(db, {
    template,
    to: o.customerEmail,
    dedupeKey: `${template}:${o.id}`,
    payload: {
      orderId: o.id, orderNumber: o.orderNumber, name: o.shippingAddress?.fullName, subtotal: o.subtotal, shipping: o.shipping, total: o.total,
      items: o.items.map((i: any) => ({ name: i.name, quantity: i.quantity, lineTotal: i.lineTotal })), paymentExpiresAt: o.paymentExpiresAt, ...extra,
    },
  });
}

// 2) DISPATCH: move PENDING rows to the queue (or send them right away in inline mode). Safe to call any time, any number of times.
export async function dispatchPending(limit = 50): Promise<number> {
  const rows = await repo.claimBatch(pool, limit);
  if (!rows.length) return 0;
  if (emailMode() === "inline") {
    for (const r of rows) await processEmail(r.id).catch(() => {});
    return rows.length;
  }
  try { await queueReady(1500); } catch { await repo.unclaim(pool, rows.map((r) => r.id)); return 0; } // queue down: rows stay PENDING for the dispatcher job
  const queue = getQueue(EMAIL_QUEUE);
  const unqueued: string[] = [];
  let queued = 0;
  for (const r of rows) {
    try {
      await withTimeout(
        queue.add("send", { emailId: r.id }, {
          priority: r.priority, // lower number runs first
          attempts: maxAttempts(),
          backoff: { type: "exponential", delay: backoffMs() },
          jobId: `email-${r.id}-${Date.now()}`, // a re-dispatch after a lost job must not be swallowed by the old job id
        }),
      );
      queued++;
    } catch {
      unqueued.push(r.id); // queue/Redis unavailable: the row stays PENDING, the dispatcher job will pick it up again
    }
  }
  if (unqueued.length) await repo.unclaim(pool, unqueued);
  return queued;
}

// Best-effort "send soon": call after the transaction commits. Never throws into business code.
export const kickEmails = async () => { try { await dispatchPending(); } catch (e) { console.error("email dispatch failed:", e instanceof Error ? e.message : e); } };

// Record + kick, for emails created outside a transaction (verification, password reset, alerts).
export async function enqueueEmail(e: EmailInput) {
  try { await recordEmail(pool, e); } catch (err) { console.error("could not record email:", err instanceof Error ? err.message : err); return; }
  await kickEmails();
}

// 3) PROCESS: the job body. An IDEMPOTENT consumer: queues deliver at-least-once, so the same job can arrive twice,
//    even at the same time. The row lock means only ONE processor sends a given email; the rest skip it.
export async function processEmail(id: string, attempt?: { made: number; max: number }): Promise<"sent" | "skipped"> {
  const outcome = await withTransaction(async (db) => {
    const row = await repo.getForUpdate(db, id);
    if (!row || row.status !== "PENDING") return { sent: false as const, error: undefined }; // already sent / dead / being sent right now
    const { subject, html, text } = render(row.template as Template, row.payload);
    try {
      // Same idempotency key on every attempt: if the provider accepted a send but we crashed before recording it,
      // the retry can't email twice. (A crash rolls this transaction back, leaving the row PENDING.)
      const res = await provider().send({ to: row.toEmail, subject, html, text, idempotencyKey: row.dedupeKey });
      await repo.markSent(db, id, res.id);
      return { sent: true as const, error: undefined };
    } catch (e) {
      const message = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      const permanent = e instanceof ProviderError && e.permanent;
      const lastTry = !attempt || attempt.made + 1 >= attempt.max;
      await repo.markAttempt(db, id, message, permanent || lastTry); // committed: FAILED when retrying is pointless or the budget is spent
      return { sent: false as const, error: permanent ? new UnrecoverableError(message) : e }; // thrown AFTER the commit
    }
  });
  if (outcome.error) throw outcome.error; // permanent: BullMQ won't retry. transient: BullMQ retries with exponential backoff.
  return outcome.sent ? "sent" : "skipped";
}

// ---- admin ----
export async function list(q: { status?: string; page: number; limit: number }) {
  const { items, total } = await repo.list(pool, q);
  return { items, meta: { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) } };
}

export async function stats() {
  const counts = await repo.counts(pool);
  let queue: Record<string, number> | null = null;
  try { queue = await withTimeout(getQueue(EMAIL_QUEUE).getJobCounts("waiting", "active", "delayed", "failed", "completed")); } catch { /* queue unavailable */ }
  return { emails: { PENDING: counts.PENDING ?? 0, SENT: counts.SENT ?? 0, FAILED: counts.FAILED ?? 0 }, queue, mode: emailMode(), provider: provider().name };
}

export async function retry(id: string) {
  if (!(await repo.reset(pool, id))) throw new HttpError(404, "No failed email with that id");
  await kickEmails();
}
