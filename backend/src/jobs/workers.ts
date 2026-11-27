import { Worker } from "bullmq";
import { EMAIL_QUEUE, MAINTENANCE_QUEUE, queuePrefix, workerConnection } from "../config/queue";
import { expireStale as expireReservations } from "../modules/inventory/inventory.service";
import { dispatchPending, processEmail } from "../modules/notifications/email.service";
import { expireStale as expireOrders } from "../modules/orders/order.service";
import { reconcile } from "../modules/payments/payment.service";
import { refreshSales } from "../modules/analytics/analytics.service";
import { runCleanup } from "./cleanup";

// The scheduled maintenance tasks. Each is idempotent, so running one twice (or on two instances) is harmless.
export async function runMaintenance(name: string): Promise<unknown> {
  switch (name) {
    case "expire-reservations": return expireReservations();
    case "expire-orders": return expireOrders();
    case "reconcile-payments": return process.env.STRIPE_SECRET_KEY ? reconcile() : "skipped (Stripe not configured)";
    case "email-dispatch": return dispatchPending(200); // heals emails whose enqueue failed (Redis blip) or whose job was lost
    case "refresh-sales": return refreshSales();
    case "cleanup": return runCleanup();
    default: throw new Error(`unknown maintenance job: ${name}`);
  }
}

export function startWorkers() {
  const connections = [workerConnection(), workerConnection()]; // BullMQ does not close connections you hand it: we do, on close()
  const email = new Worker(EMAIL_QUEUE, (job) => processEmail(job.data.emailId, { made: job.attemptsMade, max: job.opts.attempts ?? 1 }), {
    connection: connections[0],
    prefix: queuePrefix(),
    concurrency: Number(process.env.EMAIL_CONCURRENCY ?? 5),
    limiter: { max: Number(process.env.EMAIL_RATE_PER_SEC ?? 2), duration: 1000 }, // stay under the provider's rate limit
  });
  const maintenance = new Worker(MAINTENANCE_QUEUE, (job) => runMaintenance(job.name), { connection: connections[1], prefix: queuePrefix(), concurrency: 1 });

  for (const [name, w] of [["email", email], ["maintenance", maintenance]] as const) {
    w.on("error", (e) => console.error(`[${name} worker]`, e.message));
    w.on("failed", (job, e) => console.warn(`[${name}] job ${job?.name}#${job?.id} failed (attempt ${job?.attemptsMade}/${job?.opts.attempts ?? 1}): ${e.message}`));
  }
  return {
    email,
    maintenance,
    close: async () => { await Promise.all([email.close(), maintenance.close()]); connections.forEach((c) => c.disconnect()); },
  };
}
