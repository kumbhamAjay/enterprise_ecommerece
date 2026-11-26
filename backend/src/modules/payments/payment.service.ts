import type Stripe from "stripe";
import { pool, withTransaction } from "../../config/db";
import { getStripe } from "../../config/stripe";
import { HttpError } from "../../utils/httpError";
import type { Db } from "../auth/auth.repository";
import * as orderRepo from "../orders/order.repository";
import { kickEmails } from "../notifications/email.service";
import { settlePaymentInTx } from "../orders/order.service";
import { toCents } from "../orders/pricing";
import * as repo from "./payment.repository";

const RETRIES = 3;
const OPEN_INTENT = new Set(["requires_payment_method", "requires_confirmation", "requires_action", "processing"]);
const short = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

// ---------------------------------------------------------------------------------------------
// 1. Start paying: create (or reuse) the PaymentIntent for an order.
//    The amount comes from OUR database, never from the browser. Card details go browser -> Stripe directly (PCI scope stays with Stripe).
// ---------------------------------------------------------------------------------------------
export async function startPayment(orderId: string, userId: string) {
  const order = await orderRepo.getOrder(pool, orderId);
  if (!order || order.userId !== userId) throw new HttpError(404, "Order not found");
  if (order.status !== "PENDING_PAYMENT") throw new HttpError(409, order.status === "CANCELLED" ? "This order was cancelled" : "This order is already paid");
  if (order.paymentExpiresAt && new Date(order.paymentExpiresAt) <= new Date()) throw new HttpError(409, "The payment window for this order has ended");

  const stripe = getStripe();
  const amountCents = toCents(order.total);
  const currency = String(order.currency).trim().toLowerCase();
  // the publishable key may be named STRIPE_PUBLISHABLE_KEY or STRIPE_PUBLIC_KEY
  const respond = (pi: Stripe.PaymentIntent) => ({ clientSecret: pi.client_secret as string, publishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? process.env.STRIPE_PUBLIC_KEY ?? null, amountCents, currency });

  const last = await repo.latestPayment(pool, orderId);
  if (last && (last.status === "PENDING" || last.status === "FAILED")) {
    const pi = await stripe.paymentIntents.retrieve(last.intentId); // a declined card can simply try again on the same intent
    if (pi.status === "succeeded") { await syncPayment(orderId, userId); throw new HttpError(409, "This order is already paid"); }
    if (OPEN_INTENT.has(pi.status)) return respond(pi);
  }

  const attempt = (last?.attempt ?? 0) + 1;
  // Stripe-side idempotency: two simultaneous requests (double click, two tabs) get the SAME intent back, not two charges.
  const pi = await stripe.paymentIntents.create(
    { amount: amountCents, currency, automatic_payment_methods: { enabled: true }, description: `Order ${order.orderNumber}`, metadata: { orderId: String(order.id), orderNumber: order.orderNumber } },
    { idempotencyKey: `order-${order.id}-attempt-${attempt}` },
  );
  await repo.insertPayment(pool, { orderId, intentId: pi.id, attempt, amountCents, currency });
  return respond(pi);
}

// ---------------------------------------------------------------------------------------------
// 2. Webhooks: the source of truth for "was it paid". The browser redirect proves nothing.
// ---------------------------------------------------------------------------------------------
export async function processEvent(event: Stripe.Event): Promise<"processed" | "duplicate" | "ignored"> {
  const object = event.data.object as { id?: string };
  const result = await withTransaction(async (db) => {
    // Claim + effect in ONE transaction. If anything below throws, the claim rolls back too, we answer 500, and Stripe
    // redelivers (it retries for days): nothing is half-applied and nothing is lost. If it commits, duplicates are no-ops.
    if (!(await repo.claimEvent(db, event.id, event.type, object.id ?? null))) return "duplicate" as const;
    switch (event.type) {
      case "payment_intent.succeeded": await onSucceeded(db, event.data.object as Stripe.PaymentIntent); return "processed" as const;
      case "payment_intent.payment_failed": await onFailed(db, event.data.object as Stripe.PaymentIntent); return "processed" as const;
      case "payment_intent.canceled": await onCanceled(db, event.data.object as Stripe.PaymentIntent); return "processed" as const;
      case "charge.refunded": await onChargeRefunded(db, event.data.object as Stripe.Charge); return "processed" as const;
      default: return "ignored" as const; // still recorded, so a replay is cheap
    }
  }, { retries: RETRIES });
  if (result === "processed") {
    await flushRefunds().catch((e) => console.error("refund flush failed:", e)); // best-effort; the reconciler retries
    await kickEmails(); // e.g. "payment received" recorded by the transaction above
  }
  return result;
}

// Settle a succeeded PaymentIntent. Idempotent: state-based, so webhook + browser sync + reconciler can all call it.
async function onSucceeded(db: Db, pi: Stripe.PaymentIntent) {
  const payment = await repo.paymentByIntent(db, pi.id); // row lock
  if (!payment) { console.warn(`payment_intent ${pi.id} succeeded but is not one of ours`); return; }
  if (payment.status === "SUCCEEDED") return; // already settled (duplicate / out-of-order delivery)

  if (pi.amount_received !== payment.amountCents || pi.currency !== payment.currency.toLowerCase()) {
    // Should be impossible (we set the amount), so don't guess: record it for a human, apply nothing, refund nothing.
    await repo.setPaymentStatus(db, payment.id, "SUCCEEDED", { applied: false, error: `Amount mismatch: expected ${payment.amountCents} ${payment.currency}, received ${pi.amount_received} ${pi.currency}` });
    console.error(`payment ${payment.id}: amount mismatch, needs manual review`);
    return;
  }
  const outcome = await settlePaymentInTx(db, payment.orderId);
  if (outcome === "APPLIED") return void (await repo.setPaymentStatus(db, payment.id, "SUCCEEDED", { applied: true }));

  // Money was taken but the order can't be fulfilled (hold expired, order cancelled, or already paid another way): give it back.
  await repo.setPaymentStatus(db, payment.id, "SUCCEEDED", { applied: false, error: "Paid after the order could no longer be fulfilled; refund queued" });
  await repo.queueRefund(db, payment, "LATE_PAYMENT");
}

async function onFailed(db: Db, pi: Stripe.PaymentIntent) {
  const payment = await repo.paymentByIntent(db, pi.id);
  if (!payment || payment.status === "SUCCEEDED" || payment.status === "CANCELED") return; // events can arrive out of order
  await repo.setPaymentStatus(db, payment.id, "FAILED", { error: pi.last_payment_error?.message?.slice(0, 300) ?? "Payment failed" });
}

async function onCanceled(db: Db, pi: Stripe.PaymentIntent) {
  const payment = await repo.paymentByIntent(db, pi.id);
  if (!payment || payment.status === "SUCCEEDED") return;
  await repo.setPaymentStatus(db, payment.id, "CANCELED");
}

async function onChargeRefunded(db: Db, charge: Stripe.Charge) {
  const intentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  const payment = intentId ? await repo.paymentByIntent(db, intentId) : undefined;
  if (payment) await repo.syncRefunded(db, payment.id, charge.amount_refunded);
}

// ---------------------------------------------------------------------------------------------
// 3. Refunds: executed from the outbox, retried until they succeed.
// ---------------------------------------------------------------------------------------------
export async function flushRefunds(orderId?: string): Promise<number> {
  const jobs = await repo.claimRefunds(pool, orderId);
  let done = 0;
  for (const j of jobs) {
    try {
      const refund = await getStripe().refunds.create(
        { payment_intent: j.intentId, amount: j.amountCents },
        { idempotencyKey: `refund-${j.id}` }, // retries (or a crash after the call) can never refund twice
      );
      const ok = refund.status !== "failed" && refund.status !== "canceled";
      await repo.finishRefund(pool, j.id, ok ? "SUCCEEDED" : "FAILED", refund.id, ok ? null : `Stripe refund ${refund.status}`);
      if (ok) { await repo.syncRefunded(pool, j.paymentId); done++; }
    } catch (e) {
      await repo.noteRefundError(pool, j.id, short(e), j.attempts >= repo.MAX_REFUND_ATTEMPTS); // stays PENDING: the next sweep retries
    }
  }
  return done;
}

// ---------------------------------------------------------------------------------------------
// 4. Browser "sync" and reconciliation: ask Stripe directly instead of waiting for a webhook that may never come.
// ---------------------------------------------------------------------------------------------
async function applyFromStripe(payment: repo.Payment): Promise<"applied" | "canceled" | "open"> {
  const stripe = getStripe();
  const pi = await stripe.paymentIntents.retrieve(payment.intentId);
  if (pi.status === "succeeded") {
    await withTransaction((db) => onSucceeded(db, pi), { retries: RETRIES });
    return "applied";
  }
  if (pi.status === "canceled") {
    await withTransaction(async (db) => onCanceled(db, pi), { retries: RETRIES });
    return "canceled";
  }
  return "open";
}

// The customer's browser says "I paid". We don't trust that: we ask Stripe.
export async function syncPayment(orderId: string, userId: string) {
  const order = await orderRepo.getOrder(pool, orderId);
  if (!order || order.userId !== userId) throw new HttpError(404, "Order not found");
  const payment = await repo.latestPayment(pool, orderId);
  if (payment && payment.status !== "SUCCEEDED") {
    await applyFromStripe(payment);
    await flushRefunds(orderId).catch(() => {});
  }
  return orderRepo.getOrder(pool, orderId);
}

// Safety net for lost webhooks, abandoned payments and failed refunds. Safe to run any time, any number of times.
export async function reconcile() {
  const summary = { checked: 0, applied: 0, canceled: 0, refundsDone: 0 };
  for (const payment of await repo.stalePayments(pool, 120)) {
    summary.checked++;
    try {
      const order = await orderRepo.getOrder(pool, payment.orderId);
      if (order && order.status !== "PENDING_PAYMENT") {
        // The order is gone (expired/cancelled): make sure the customer can't still pay for it.
        const pi = await getStripe().paymentIntents.retrieve(payment.intentId);
        if (pi.status === "succeeded") { await applyFromStripe(payment); summary.applied++; continue; } // late payment -> refund queued
        if (OPEN_INTENT.has(pi.status)) await getStripe().paymentIntents.cancel(payment.intentId);
        await withTransaction((db) => onCanceled(db, { ...pi, status: "canceled" } as Stripe.PaymentIntent));
        summary.canceled++;
        continue;
      }
      const r = await applyFromStripe(payment);
      if (r === "applied") summary.applied++;
      if (r === "canceled") summary.canceled++;
    } catch (e) {
      console.error(`reconcile payment ${payment.id} failed:`, short(e)); // one bad payment must not block the rest
    }
  }
  summary.refundsDone = await flushRefunds();
  return summary;
}
