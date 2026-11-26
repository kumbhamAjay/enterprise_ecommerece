import type { Db } from "../auth/auth.repository";

// Get-or-create in ONE statement (UNIQUE(user_id) + ON CONFLICT). The DO UPDATE also row-locks the cart until
// commit, so every mutation of one user's cart is serialized without any extra lock statement.
export async function lockOrCreateCart(db: Db, userId: string): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO carts (user_id) VALUES ($1) ON CONFLICT (user_id) DO UPDATE SET updated_at = now() RETURNING id`,
    [userId],
  );
  return rows[0].id;
}

export async function lineQuantity(db: Db, cartId: string, productId: string): Promise<number> {
  const { rows } = await db.query(`SELECT quantity FROM cart_items WHERE cart_id = $1 AND product_id = $2`, [cartId, productId]);
  return rows[0]?.quantity ?? 0;
}

export async function setLine(db: Db, cartId: string, productId: string, quantity: number) {
  await db.query(
    `INSERT INTO cart_items (cart_id, product_id, quantity) VALUES ($1, $2, $3)
     ON CONFLICT (cart_id, product_id) DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now()`,
    [cartId, productId, quantity],
  );
}

export const removeLine = (db: Db, cartId: string, productId: string) =>
  db.query(`DELETE FROM cart_items WHERE cart_id = $1 AND product_id = $2`, [cartId, productId]);

export const clearLines = (db: Db, cartId: string) => db.query(`DELETE FROM cart_items WHERE cart_id = $1`, [cartId]);

// What a product can currently offer. undefined = no such product.
export async function stockFor(db: Db, productId: string): Promise<{ active: boolean; available: number } | undefined> {
  const { rows } = await db.query(
    `SELECT p.is_active AS active, COALESCE(i.quantity_on_hand - i.reserved_quantity, 0) AS available
     FROM products p LEFT JOIN inventory i ON i.product_id = p.id WHERE p.id = $1`,
    [productId],
  );
  return rows[0];
}

// The whole cart in one query: lines, live price/stock, and the totals via window aggregates.
export async function readCart(db: Db, userId: string) {
  const { rows } = await db.query(
    `SELECT p.id AS "productId", p.name, p.sku, p.slug, p.price AS "unitPrice", p.is_active AS "isActive", ci.quantity,
            (p.price * ci.quantity) AS "lineTotal",
            COALESCE(i.quantity_on_hand - i.reserved_quantity, 0) AS available,
            (SELECT url FROM product_images im WHERE im.product_id = p.id ORDER BY position, id LIMIT 1) AS "imageUrl",
            SUM(CASE WHEN p.is_active THEN p.price * ci.quantity ELSE 0 END) OVER ()::numeric(14,2) AS subtotal, -- fixed scale: always "0.00", never "0"
            SUM(ci.quantity) OVER () AS "itemCount"
     FROM carts c
     JOIN cart_items ci ON ci.cart_id = c.id
     JOIN products p ON p.id = ci.product_id
     LEFT JOIN inventory i ON i.product_id = p.id
     WHERE c.user_id = $1
     ORDER BY ci.added_at, p.id`,
    [userId],
  );
  return rows;
}
