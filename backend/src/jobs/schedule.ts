import { MAINTENANCE_QUEUE, getQueue, queueReady, withTimeout } from "../config/queue";
import { runMaintenance } from "./workers";

// Repeatable jobs. upsertJobScheduler is idempotent: every instance can call it at boot, there is exactly one schedule,
// and Redis makes sure each tick runs ONCE across all workers (this replaces the old per-process setInterval + lock).
export async function scheduleJobs() {
  await queueReady(3000); // throws if Redis is unreachable: the caller falls back to timers
  const q = getQueue(MAINTENANCE_QUEUE);
  const every = (id: string, ms: number) => withTimeout(q.upsertJobScheduler(id, { every: ms }, { name: id }), 3000);
  await every("expire-reservations", 60_000);
  await every("expire-orders", 60_000);
  await every("email-dispatch", 30_000);
  await every("refresh-sales", 5 * 60_000);
  await withTimeout(q.upsertJobScheduler("cleanup", { pattern: "0 3 * * *" }, { name: "cleanup" }), 3000); // daily 03:00
  if (process.env.STRIPE_SECRET_KEY) await every("reconcile-payments", 5 * 60_000);
  else await q.removeJobScheduler("reconcile-payments").catch(() => {});
}

// If Redis is unreachable at boot there is no queue: fall back to plain in-process timers so reservations and orders
// still expire. (Emails still reach the outbox and are sent when the queue is back.)
export function startTimerFallback() {
  const loop = (name: string, ms: number) => setInterval(() => runMaintenance(name).catch((e) => console.error(`${name} failed:`, e.message)), ms).unref();
  loop("expire-reservations", 60_000);
  loop("expire-orders", 60_000);
  loop("email-dispatch", 30_000);
  loop("refresh-sales", 5 * 60_000);
  if (process.env.STRIPE_SECRET_KEY) loop("reconcile-payments", 5 * 60_000);
}
