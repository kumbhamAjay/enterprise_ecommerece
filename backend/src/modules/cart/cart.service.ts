import { pool, withTransaction } from "../../config/db";
import { HttpError } from "../../utils/httpError";
import * as repo from "./cart.repository";
import { MAX_PER_LINE, type CartIssue } from "./cart.types";

export async function getCart(userId: string) {
  const rows = await repo.readCart(pool, userId);
  const items = rows.map(({ subtotal, itemCount, ...r }) => {
    const issues: CartIssue[] = [];
    if (!r.isActive) issues.push("UNAVAILABLE");
    else if (r.available <= 0) issues.push("OUT_OF_STOCK");
    else if (r.quantity > r.available) issues.push("INSUFFICIENT_STOCK");
    return { ...r, issues };
  });
  return {
    items,
    itemCount: rows[0] ? Number(rows[0].itemCount) : 0,
    subtotal: rows[0] ? rows[0].subtotal : "0.00", // numeric stays a string: no float rounding on money
    currency: "USD",
    hasIssues: items.some((i) => i.issues.length > 0),
  };
}

// The cart VALIDATES stock; it does not reserve it. Holding stock for carts that may never check out would let
// abandoned carts hoard inventory. The hold happens at checkout (Module 5) via inventory.reserve().
function assertCanHold(stock: Awaited<ReturnType<typeof repo.stockFor>>, wanted: number) {
  if (!stock || !stock.active) throw new HttpError(404, "Product not found");
  if (wanted > MAX_PER_LINE) throw new HttpError(409, `Limit is ${MAX_PER_LINE} per item`);
  if (wanted > stock.available) throw new HttpError(409, stock.available > 0 ? `Only ${stock.available} available` : "Out of stock");
}

// Every mutation locks the user's cart row (see lockOrCreateCart), so read-check-write below can't interleave
// with another request on the same cart (double-clicks, two tabs). Contention is per user, so this is cheap.
export async function addItem(userId: string, productId: string, quantity: number) {
  await withTransaction(async (db) => {
    const cartId = await repo.lockOrCreateCart(db, userId);
    const next = (await repo.lineQuantity(db, cartId, productId)) + quantity;
    assertCanHold(await repo.stockFor(db, productId), next);
    await repo.setLine(db, cartId, productId, next);
  }, { retries: 3 });
  return getCart(userId);
}

export async function setQuantity(userId: string, productId: string, quantity: number) {
  await withTransaction(async (db) => {
    const cartId = await repo.lockOrCreateCart(db, userId);
    if ((await repo.lineQuantity(db, cartId, productId)) === 0) throw new HttpError(404, "Item is not in your cart");
    assertCanHold(await repo.stockFor(db, productId), quantity);
    await repo.setLine(db, cartId, productId, quantity);
  }, { retries: 3 });
  return getCart(userId);
}

export async function removeItem(userId: string, productId: string) {
  await withTransaction(async (db) => repo.removeLine(db, await repo.lockOrCreateCart(db, userId), productId)); // idempotent
  return getCart(userId);
}

export async function clear(userId: string) {
  await withTransaction(async (db) => repo.clearLines(db, await repo.lockOrCreateCart(db, userId)));
  return getCart(userId);
}

// Merge a guest cart (from the browser) into the user's cart after login.
// Rule: per product keep the LARGER quantity (not the sum), so retrying the same merge is harmless (idempotent).
// Merging is lenient: unavailable items are skipped and quantities clamped, never an error.
export async function merge(userId: string, guest: { productId: string; quantity: number }[]) {
  const wanted = new Map<string, number>();
  for (const g of guest) wanted.set(g.productId, Math.max(wanted.get(g.productId) ?? 0, g.quantity));
  const ordered = [...wanted].sort((a, b) => (BigInt(a[0]) < BigInt(b[0]) ? -1 : 1));

  const skipped: { productId: string; reason: "UNAVAILABLE" | "OUT_OF_STOCK" }[] = [];
  const adjusted: { productId: string; wanted: number; got: number }[] = [];

  await withTransaction(async (db) => {
    skipped.length = adjusted.length = 0; // a retried transaction starts the report over
    const cartId = await repo.lockOrCreateCart(db, userId);
    for (const [productId, qty] of ordered) {
      const stock = await repo.stockFor(db, productId);
      if (!stock || !stock.active) { skipped.push({ productId, reason: "UNAVAILABLE" }); continue; }
      const existing = await repo.lineQuantity(db, cartId, productId);
      if (qty <= existing) continue; // the server cart already has at least this many: never shrink a line
      const got = Math.min(qty, MAX_PER_LINE, stock.available);
      if (got <= existing) { // stock can't support any increase
        if (existing === 0) skipped.push({ productId, reason: "OUT_OF_STOCK" });
        continue;
      }
      if (got < qty) adjusted.push({ productId, wanted: qty, got });
      await repo.setLine(db, cartId, productId, got);
    }
  }, { retries: 3 });

  return { cart: await getCart(userId), skipped, adjusted };
}
