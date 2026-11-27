import { pool, withTransaction } from "../../config/db";
import { HttpError } from "../../utils/httpError";
import { afterWrite } from "../../utils/cache";
import { enqueueEmail } from "../notifications/email.service";
import type { Db } from "../auth/auth.repository";
import * as repo from "./inventory.repository";
import type { AdjustInput, ListQuery, ReserveItem } from "./inventory.types";

const RESERVATION_TTL_MS = Number(process.env.RESERVATION_TTL_MINUTES ?? 15) * 60_000;
const RETRIES = 3; // deadlock / serialization failures are retried

export type StockStatus = "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK";
export const statusOf = (available: number, threshold: number): StockStatus =>
  available <= 0 ? "OUT_OF_STOCK" : available <= threshold ? "LOW_STOCK" : "IN_STOCK";

const withStatus = (r: any) => ({ ...r, status: statusOf(r.available, r.lowStockThreshold) });

// "Did this change just push available stock down through the threshold?" -> one alert, not one per sale
const crossedDown = (after: repo.Stock, removed: number) => {
  const available = after.onHand - after.reserved;
  return available + removed > after.threshold && available <= after.threshold;
};

// Best-effort, after commit: a failed email must never undo or fail a stock movement.
// One alert per product per admin per hour at most (dedupe key), however often stock crosses the line.
export async function notifyLowStock(productId: string) {
  try {
    const [label, view, admins] = await Promise.all([repo.productLabel(pool, productId), repo.getInventory(pool, productId), repo.adminEmails(pool)]);
    if (!label || !view) return;
    const hour = Math.floor(Date.now() / 3_600_000);
    await Promise.all(
      admins.map((to) =>
        enqueueEmail({ template: "low-stock", to, dedupeKey: `low-stock:${productId}:${to}:${hour}`, payload: { name: label.name, sku: label.sku, available: view.available, threshold: view.lowStockThreshold } }),
      ),
    );
  } catch (e) {
    console.error("low-stock notification failed:", e);
  }
}

// Why did the atomic UPDATE touch 0 rows? Distinguish "no such product" from "not enough stock".
async function shortage(db: Db, productId: string) {
  const available = await repo.availability(db, productId);
  return available === undefined
    ? new HttpError(404, "Product not found", { productId })
    : new HttpError(409, available > 0 ? `Only ${available} available` : "Out of stock", { productId, available });
}

// ---------------------------------------------------------------------------------------------
// Reservations
// ---------------------------------------------------------------------------------------------
// Transaction-scoped: callers that must reserve stock as part of a bigger unit of work (checkout) pass their own
// client, so a failure anywhere rolls back the reservations, the order and the cart together.
export async function reserveInTx(db: Db, items: ReserveItem[], userId: string, expiresAt = new Date(Date.now() + RESERVATION_TTL_MS)) {
  const merged = [...items.reduce((m, i) => m.set(i.productId, (m.get(i.productId) ?? 0) + i.quantity), new Map<string, number>())]
    // Always lock rows in ascending product id. Two requests that want {A,B} and {B,A} then queue up
    // instead of each holding one row and waiting for the other (that is how deadlocks happen).
    .sort((a, b) => (BigInt(a[0]) < BigInt(b[0]) ? -1 : 1));

  const reservations = [];
  const crossed: string[] = [];
  for (const [productId, quantity] of merged) {
    const row = await repo.reserveUnits(db, productId, quantity);
    if (!row) throw await shortage(db, productId); // throws -> ROLLBACK -> earlier items in this unit of work are undone too
    const r = await repo.insertReservation(db, { productId, userId, quantity, expiresAt });
    await repo.logTxn(db, { productId, type: "RESERVE", reservedDelta: quantity, onHandAfter: row.onHand, reservedAfter: row.reserved, reservationId: r.id, actorId: userId });
    reservations.push({ id: r.id, productId, quantity, expiresAt: r.expiresAt });
    if (crossedDown(row, quantity)) crossed.push(productId);
  }
  return { reservations, crossed };
}

export async function reserve(items: ReserveItem[], userId: string) {
  const { reservations, crossed } = await withTransaction((db) => reserveInTx(db, items, userId), { retries: RETRIES });
  await Promise.all(crossed.map(notifyLowStock)); // after commit
  return reservations;
}

// Refunded before shipping: the units go back on the shelf (and into the ledger as a RETURN).
export async function returnToStock(db: Db, productId: string, quantity: number, actorId: string | null, note: string) {
  const row = await repo.adjustOnHand(db, productId, quantity);
  if (!row) return; // product row gone: nothing to restock
  await repo.logTxn(db, { productId, type: "RETURN", quantityDelta: quantity, onHandAfter: row.onHand, reservedAfter: row.reserved, actorId, note });
}

// ACTIVE -> final state + stock movement, in one transaction. Returns false if it was already resolved.
export async function settleReservation(db: Db, id: string, status: "CONFIRMED" | "RELEASED" | "EXPIRED", actorId: string | null): Promise<boolean> {
  const r = await repo.resolveReservation(db, id, status);
  if (!r) return false;
  const sold = status === "CONFIRMED";
  const row = sold ? await repo.confirmUnits(db, r.productId, r.quantity) : await repo.releaseUnits(db, r.productId, r.quantity);
  await repo.logTxn(db, {
    productId: r.productId,
    type: sold ? "SALE" : status === "EXPIRED" ? "EXPIRE" : "RELEASE",
    quantityDelta: sold ? -r.quantity : 0,
    reservedDelta: -r.quantity,
    onHandAfter: row.onHand,
    reservedAfter: row.reserved,
    reservationId: id,
    actorId,
  });
  return true;
}

export async function release(id: string, actor: { id: string; isAdmin: boolean }) {
  const r = await repo.findReservation(pool, id);
  if (!r || (r.userId !== actor.id && !actor.isAdmin)) throw new HttpError(404, "Reservation not found"); // 404, not 403: don't reveal other users' ids
  await withTransaction((db) => settleReservation(db, id, "RELEASED", actor.id), { retries: RETRIES });
  return { id, status: (await repo.findReservation(pool, id))!.status }; // idempotent: releasing twice is fine
}

// Called by Orders (Module 5) once payment succeeds. false = the hold had already expired/been released.
export const confirm = (id: string) => withTransaction((db) => settleReservation(db, id, "CONFIRMED", null), { retries: RETRIES });

// Frees stock held by abandoned carts. ponytail: run from an in-process timer; move to a BullMQ repeatable job in Module 8.
export async function expireStale(batch = 100): Promise<number> {
  let total = 0;
  for (;;) {
    const n = await withTransaction(async (db) => {
      const rows = await repo.lockExpired(db, batch);
      for (const r of rows) await settleReservation(db, r.id, "EXPIRED", null);
      return rows.length;
    }, { retries: RETRIES });
    total += n;
    if (n < batch) return total;
  }
}

// ---------------------------------------------------------------------------------------------
// Admin: stock levels
// ---------------------------------------------------------------------------------------------
async function view(productId: string) {
  const v = await repo.getInventory(pool, productId);
  if (!v) throw new HttpError(404, "Product not found");
  return withStatus(v);
}
export const getOne = view;

export async function list(q: ListQuery) {
  const { items, total } = await repo.listInventory(pool, q);
  return { items: items.map(withStatus), meta: { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) } };
}

async function adjustRaw(productId: string, { delta, type, note }: AdjustInput, actorId: string) {
  const row = await withTransaction(async (db) => {
    const row = await repo.adjustOnHand(db, productId, delta); // atomic; refuses to drop below reserved
    if (!row) {
      const v = await repo.getInventory(db, productId);
      throw v ? new HttpError(409, `Can’t remove that much: ${v.reserved} units are reserved for customers`) : new HttpError(404, "Product not found");
    }
    await repo.logTxn(db, { productId, type, quantityDelta: delta, onHandAfter: row.onHand, reservedAfter: row.reserved, actorId, note });
    return row;
  }, { retries: RETRIES });
  if (delta < 0 && crossedDown(row, -delta)) await notifyLowStock(productId);
  return view(productId);
}

// Stocktake: "there are exactly N on the shelf". The delta depends on the current value, so lock the row first.
async function setStockRaw(productId: string, quantity: number, note: string | undefined, actorId: string) {
  const { row, delta } = await withTransaction(async (db) => {
    const cur = await repo.lockStock(db, productId); // SELECT ... FOR UPDATE: others wait until we commit
    if (!cur) throw new HttpError(404, "Product not found");
    if (quantity < cur.reserved) throw new HttpError(409, `Can’t set below ${cur.reserved}: those units are reserved for customers`);
    const delta = quantity - cur.onHand;
    if (delta === 0) return { row: cur, delta };
    const row = await repo.setOnHand(db, productId, quantity);
    await repo.logTxn(db, { productId, type: "CORRECTION", quantityDelta: delta, onHandAfter: row.onHand, reservedAfter: row.reserved, actorId, note: note ?? "Stocktake" });
    return { row, delta };
  }, { retries: RETRIES });
  if (delta < 0 && crossedDown(row, -delta)) await notifyLowStock(productId);
  return view(productId);
}

async function setThresholdRaw(productId: string, t: number) {
  if (!(await repo.setThreshold(pool, productId, t))) throw new HttpError(404, "Product not found");
  return view(productId);
}

export async function history(productId: string, page: number, limit: number) {
  await view(productId); // 404 for unknown products
  const { items, total } = await repo.history(pool, productId, page, limit);
  return { items, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

// Admin stock changes alter the public stock badges, so they invalidate the catalog cache.
// (Customer reservations are far too frequent to invalidate on; browsing may lag by the TTL.)
export const adjust = afterWrite(adjustRaw);
export const setStock = afterWrite(setStockRaw);
export const setThreshold = afterWrite(setThresholdRaw);
