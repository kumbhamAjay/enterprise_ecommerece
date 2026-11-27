import { createHash, randomBytes } from "crypto";
import { pool, withTransaction } from "../../config/db";
import { HttpError } from "../../utils/httpError";
import type { Db } from "../auth/auth.repository";
import * as cartRepo from "../cart/cart.repository";
import { getCart } from "../cart/cart.service";
import * as inventory from "../inventory/inventory.service";
import { kickEmails, recordOrderEmail } from "../notifications/email.service";
import * as paymentRepo from "../payments/payment.repository";
import * as repo from "./order.repository";
import { fromCents, priceOrder, toCents } from "./pricing";
import type { Template } from "../notifications/email.templates";
import type { CheckoutInput, ListQuery, OrderStatus } from "./order.types";

const PAYMENT_WINDOW_MS = Number(process.env.ORDER_PAYMENT_WINDOW_MINUTES ?? 30) * 60_000;
const RETRIES = 3;

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------
export async function previewCheckout(userId: string) {
  const cart = await getCart(userId);
  const subtotalCents = cart.items.filter((i) => i.isActive).reduce((s, i) => s + toCents(i.lineTotal), 0);
  return { ...cart, ...priceOrder(subtotalCents) };
}

export async function getOrder(id: string, viewer: { id: string; isAdmin: boolean }) {
  const o = await repo.getOrder(pool, id);
  if (!o || (!viewer.isAdmin && o.userId !== viewer.id)) throw new HttpError(404, "Order not found"); // 404, not 403: don't confirm other people's order ids exist
  return o;
}

export async function listOrders(q: ListQuery & { userId?: string }) {
  const { items, total } = await repo.listOrders(pool, q);
  return { items, meta: { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) } };
}

// ---------------------------------------------------------------------------------------------
// Checkout: ONE transaction = claim idempotency key + lock cart + reserve stock + snapshot prices + create order + empty cart.
// Anything that fails rolls ALL of it back (no half-orders, no stuck reservations, cart untouched, key not consumed).
// ---------------------------------------------------------------------------------------------
const ORDER_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
const orderNumber = () => "AT-" + Array.from(randomBytes(8), (b) => ORDER_CHARS[b % ORDER_CHARS.length]).join("");

export async function checkout(userId: string, email: string, input: CheckoutInput, key: string) {
  const billingAddress = input.billingAddress ?? input.shippingAddress;
  const hash = createHash("sha256").update(JSON.stringify({ s: input.shippingAddress, b: billingAddress })).digest("hex");

  const { orderId, replayed, crossed } = await withTransaction(async (db) => {
    if (!(await repo.claimKey(db, userId, key, hash))) {
      const prior = await repo.getKey(db, userId, key);
      if (prior?.requestHash !== hash) throw new HttpError(422, "This Idempotency-Key was already used with a different request");
      if (!prior.orderId) throw new HttpError(409, "That checkout didn’t complete. Please retry with a new Idempotency-Key.");
      return { orderId: prior.orderId, replayed: true, crossed: [] as string[] }; // the original attempt succeeded: replay it
    }

    const cartId = await cartRepo.lockOrCreateCart(db, userId); // freezes the cart: no concurrent add/remove while we check out
    const lines = await repo.cartLines(db, cartId);
    if (lines.length === 0) throw new HttpError(409, "Your bag is empty");
    const gone = lines.find((l) => !l.active);
    if (gone) throw new HttpError(409, `${gone.name} is no longer available`, { productId: gone.productId });

    const expiresAt = new Date(Date.now() + PAYMENT_WINDOW_MS);
    const { reservations, crossed } = await inventory.reserveInTx(db, lines.map((l) => ({ productId: l.productId, quantity: l.quantity })), userId, expiresAt);
    const reservationOf = new Map(reservations.map((r) => [r.productId, r.id]));

    const items = lines.map((l) => ({ productId: l.productId, reservationId: reservationOf.get(l.productId)!, sku: l.sku, name: l.name, unitPrice: l.price, quantity: l.quantity, lineTotal: fromCents(toCents(l.price) * l.quantity) }));
    const totals = priceOrder(items.reduce((s, i) => s + toCents(i.lineTotal), 0)); // price SNAPSHOT: later price changes never touch this order

    let id: string | undefined;
    for (let attempt = 0; attempt < 5 && !id; attempt++) {
      id = await repo.insertOrder(db, { number: orderNumber(), userId, email, ...totals, shippingAddress: input.shippingAddress, billingAddress, paymentExpiresAt: expiresAt });
    }
    if (!id) throw new Error("could not allocate an order number");

    await repo.insertItems(db, id, items);
    await repo.logStatus(db, id, null, "PENDING_PAYMENT", userId, "Order placed");
    await cartRepo.clearLines(db, cartId);
    await repo.attachKey(db, userId, key, id);
    await recordOrderEmail(db, id, "order-placed"); // same transaction: no order without its confirmation email on record
    return { orderId: id, replayed: false, crossed };
  }, { retries: RETRIES });

  await Promise.all(crossed.map(inventory.notifyLowStock)); // after commit, best-effort
  if (!replayed) await kickEmails();
  return { order: await repo.getOrder(pool, orderId), replayed };
}

// ---------------------------------------------------------------------------------------------
// Order lifecycle (state machine)
//
//   PENDING_PAYMENT --paid--> PAID --> PROCESSING --> SHIPPED --> DELIVERED
//        |                      |          |             |            |
//    CANCELLED               REFUNDED   REFUNDED      REFUNDED     REFUNDED
// ---------------------------------------------------------------------------------------------
type By = "customer" | "admin" | "system";
const RULES: Partial<Record<OrderStatus, Partial<Record<OrderStatus, By[]>>>> = {
  PENDING_PAYMENT: { PAID: ["admin", "system"], CANCELLED: ["customer", "admin", "system"] },
  PAID: { PROCESSING: ["admin"], REFUNDED: ["customer", "admin"] },
  PROCESSING: { SHIPPED: ["admin"], REFUNDED: ["admin"] },
  SHIPPED: { DELIVERED: ["admin"], REFUNDED: ["admin"] },
  DELIVERED: { REFUNDED: ["admin"] },
};
export type Actor = { by: By; userId: string | null };

// Runs inside a transaction that already holds the order row lock. Stock side effects live HERE so they can never
// drift from the status: confirm on PAID, release on CANCELLED, restock on REFUNDED-before-shipping.
async function applyTransition(db: Db, o: { id: string; status: OrderStatus; orderNumber: string }, to: OrderStatus, actor: Actor, note?: string) {
  if (!RULES[o.status]?.[to]?.includes(actor.by)) throw new HttpError(409, `An order that is ${o.status.toLowerCase().replace("_", " ")} can’t be moved to ${to.toLowerCase().replace("_", " ")}`);

  const items = await repo.orderItemsForUpdate(db, o.id); // ascending product id: same lock order as reservations
  if (to === "PAID") {
    for (const i of items) {
      // The hold may have lapsed (payment window expired). Then the stock may already be someone else's: refuse, don't oversell.
      if (!i.reservationId || !(await inventory.settleReservation(db, i.reservationId, "CONFIRMED", actor.userId)))
        throw new HttpError(409, "The stock hold for this order has expired, so it can’t be completed");
    }
  } else if (to === "CANCELLED") {
    for (const i of items) if (i.reservationId) await inventory.settleReservation(db, i.reservationId, "RELEASED", actor.userId); // idempotent
  } else if (to === "REFUNDED") {
    if (o.status === "PAID" || o.status === "PROCESSING")
      for (const i of items) if (i.productId) await inventory.returnToStock(db, i.productId, i.quantity, actor.userId, `Order ${o.orderNumber} refunded`);
    await paymentRepo.queueOrderRefund(db, o.id); // the money goes back too: recorded now, executed (and retried) by the payments module
  }
  await repo.setStatus(db, o.id, to, note);
  await repo.logStatus(db, o.id, o.status, to, actor.userId, note);
  const mail = ORDER_EMAIL[to];
  if (mail) await recordOrderEmail(db, o.id, mail, { reason: note }); // outbox row commits (or rolls back) with the status change
}

// Which customer email each status change triggers (PROCESSING is internal: no email).
const ORDER_EMAIL: Partial<Record<OrderStatus, Template>> = { PAID: "order-paid", SHIPPED: "order-shipped", DELIVERED: "order-delivered", CANCELLED: "order-cancelled", REFUNDED: "order-refunded" };

async function transition(id: string, to: OrderStatus, actor: Actor, note?: string, owner?: string) {
  await withTransaction(async (db) => {
    const o = await repo.lockOrder(db, id); // serializes every change to this order
    if (!o || (owner && o.userId !== owner)) throw new HttpError(404, "Order not found");
    if (o.status === to) return; // already there: repeating the request is a no-op (idempotent)
    await applyTransition(db, o, to, actor, note);
  }, { retries: RETRIES });
  await kickEmails();
  return repo.getOrder(pool, id);
}

// Customer: cancel while unpaid, or get a (simulated) refund while paid and not yet being prepared.
export async function cancelByCustomer(id: string, userId: string, reason?: string) {
  const o = await repo.getOrder(pool, id);
  if (!o || o.userId !== userId) throw new HttpError(404, "Order not found");
  const to: OrderStatus = o.status === "PENDING_PAYMENT" || o.status === "CANCELLED" ? "CANCELLED" : "REFUNDED";
  return transition(id, to, { by: "customer", userId }, reason ?? "Cancelled by customer", userId);
}

export const adminSetStatus = (id: string, to: OrderStatus, adminId: string, note?: string) => transition(id, to, { by: "admin", userId: adminId }, note);

// For the payments module: a successful card payment confirms the order, inside the webhook's own transaction.
// SAVEPOINT: applying PAID confirms stock line by line; if the hold has lapsed we must undo the lines already confirmed
// and report "not applicable" (so the payment gets refunded) WITHOUT aborting the surrounding webhook transaction.
export async function settlePaymentInTx(db: Db, orderId: string): Promise<"APPLIED" | "NOT_APPLICABLE"> {
  const o = await repo.lockOrder(db, orderId);
  if (!o || o.status !== "PENDING_PAYMENT") return "NOT_APPLICABLE"; // cancelled, expired, or already paid some other way
  await db.query("SAVEPOINT settle_payment");
  try {
    await applyTransition(db, o, "PAID", { by: "system", userId: null }, "Payment received");
    await db.query("RELEASE SAVEPOINT settle_payment");
    return "APPLIED";
  } catch (e) {
    if (!(e instanceof HttpError)) throw e; // a real failure still aborts and rolls back everything
    await db.query("ROLLBACK TO SAVEPOINT settle_payment");
    return "NOT_APPLICABLE";
  }
}

// Unpaid orders lapse with their stock hold. ponytail: in-process timer, BullMQ repeatable job in Module 8.
export async function expireStale(batch = 50): Promise<number> {
  let total = 0;
  for (;;) {
    const n = await withTransaction(async (db) => {
      const rows = await repo.lockExpired(db, batch); // SKIP LOCKED: concurrent sweepers never collide
      for (const r of rows) {
        const o = await repo.lockOrder(db, r.id);
        if (o?.status === "PENDING_PAYMENT") await applyTransition(db, o, "CANCELLED", { by: "system", userId: null }, "Payment window expired");
      }
      return rows.length;
    }, { retries: RETRIES });
    total += n;
    if (n < batch) { if (total) await kickEmails(); return total; }
  }
}
