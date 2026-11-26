import type { Db } from "../auth/auth.repository";
import { buildSet } from "../../utils/sql";
import type { ListQuery } from "./product.types";

const MANUFACTURER = `CASE WHEN m.id IS NULL THEN NULL ELSE json_build_object('id', m.id::text, 'name', m.name) END`;
// Public stock signal. Exact counts are only revealed when stock is low ("Only 3 left").
const AVAILABLE = `(COALESCE(i.quantity_on_hand, 0) - COALESCE(i.reserved_quantity, 0))`;
const STOCK_STATUS = `CASE WHEN ${AVAILABLE} <= 0 THEN 'OUT_OF_STOCK' WHEN ${AVAILABLE} <= i.low_stock_threshold THEN 'LOW_STOCK' ELSE 'IN_STOCK' END`;
const STOCK_LEFT = `CASE WHEN ${AVAILABLE} > 0 AND ${AVAILABLE} <= i.low_stock_threshold THEN ${AVAILABLE} END`;
const STOCK_COLS = `${STOCK_STATUS} AS "stockStatus", ${STOCK_LEFT} AS "stockLeft"`;

const SORTS = {
  newest: "p.created_at DESC, p.id DESC",
  price_asc: "p.price ASC, p.id ASC",
  price_desc: "p.price DESC, p.id ASC",
  name: "p.name ASC, p.id ASC",
};

// One query builds the whole page: filters are parameterized, no N+1 (image is a subselect).
export async function listProducts(db: Db, q: ListQuery) {
  const params: unknown[] = [];
  const add = (v: unknown) => (params.push(v), `$${params.length}`);
  const where = ["p.is_active"];
  let cte = "";
  let rank = "";

  if (q.categoryId) {
    // Recursive CTE: the category plus every descendant (UNION also stops accidental cycles)
    cte = `WITH RECURSIVE cat AS (
      SELECT id FROM categories WHERE id = ${add(q.categoryId)}
      UNION SELECT c.id FROM categories c JOIN cat ON c.parent_id = cat.id) `;
    where.push(`EXISTS (SELECT 1 FROM product_categories pc WHERE pc.product_id = p.id AND pc.category_id IN (SELECT id FROM cat))`);
  }
  if (q.q) {
    const ts = `websearch_to_tsquery('english', ${add(q.q)})`; // GIN index on search_vector
    where.push(`p.search_vector @@ ${ts}`);
    rank = `ts_rank(p.search_vector, ${ts}) DESC, `;
  }
  if (q.inStock) where.push(`${AVAILABLE} > 0`);
  if (q.manufacturerId) where.push(`p.manufacturer_id = ${add(q.manufacturerId)}`);
  if (q.minPrice !== undefined) where.push(`p.price >= ${add(q.minPrice)}`);
  if (q.maxPrice !== undefined) where.push(`p.price <= ${add(q.maxPrice)}`);

  const order =
    q.sort === "relevance" || (!q.sort && q.q)
      ? `${rank}${SORTS.newest}` // relevance without a search term falls back to newest
      : SORTS[(q.sort as keyof typeof SORTS) ?? "newest"];
  const limit = add(q.limit);
  const offset = add((q.page - 1) * q.limit);

  const { rows } = await db.query(
    `${cte}SELECT p.id, p.sku, p.name, p.slug, p.price, ${MANUFACTURER} AS manufacturer, ${STOCK_COLS},
            (SELECT url FROM product_images i WHERE i.product_id = p.id ORDER BY position, id LIMIT 1) AS "imageUrl",
            COUNT(*) OVER() AS total
     FROM products p LEFT JOIN manufacturers m ON m.id = p.manufacturer_id LEFT JOIN inventory i ON i.product_id = p.id
     WHERE ${where.join(" AND ")}
     ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  return { items: rows.map(({ total, ...r }) => r), total: rows[0] ? Number(rows[0].total) : 0 };
}

export async function getProduct(db: Db, id: string, onlyActive: boolean) {
  const { rows } = await db.query(
    `SELECT p.id, p.sku, p.name, p.slug, p.description, p.price, p.is_active AS "isActive",
            p.created_at AS "createdAt", p.updated_at AS "updatedAt", ${MANUFACTURER} AS manufacturer, ${STOCK_COLS},
            COALESCE((SELECT json_agg(json_build_object('id', c.id::text, 'name', c.name, 'slug', c.slug) ORDER BY c.name)
                      FROM product_categories pc JOIN categories c ON c.id = pc.category_id
                      WHERE pc.product_id = p.id), '[]') AS categories,
            COALESCE((SELECT json_agg(json_build_object('id', i.id::text, 'url', i.url, 'position', i.position) ORDER BY i.position, i.id)
                      FROM product_images i WHERE i.product_id = p.id), '[]') AS images
     FROM products p LEFT JOIN manufacturers m ON m.id = p.manufacturer_id LEFT JOIN inventory i ON i.product_id = p.id
     WHERE p.id = $1 ${onlyActive ? "AND p.is_active" : ""}`,
    [id],
  );
  return rows[0];
}

export async function insertProduct(
  db: Db,
  p: { sku: string; name: string; slug: string; description?: string; price: number; manufacturerId?: string | null; isActive?: boolean },
): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO products (sku, name, slug, description, price, manufacturer_id, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, true)) RETURNING id`,
    [p.sku, p.name, p.slug, p.description ?? null, p.price, p.manufacturerId ?? null, p.isActive ?? null],
  );
  return rows[0].id;
}

// Always bumps updated_at, so the statement is never empty and doubles as the existence check.
export async function updateProduct(db: Db, id: string, input: Record<string, unknown>): Promise<boolean> {
  const params: unknown[] = [id];
  const sets = buildSet(
    { sku: "sku", name: "name", slug: "slug", description: "description", price: "price", manufacturerId: "manufacturer_id", isActive: "is_active" },
    input,
    params,
  );
  sets.push("updated_at = now()");
  const r = await db.query(`UPDATE products SET ${sets.join(", ")} WHERE id = $1`, params);
  return (r.rowCount ?? 0) > 0;
}

export async function setCategories(db: Db, productId: string, categoryIds: string[]) {
  await db.query(`DELETE FROM product_categories WHERE product_id = $1`, [productId]);
  if (categoryIds.length)
    await db.query(
      `INSERT INTO product_categories (product_id, category_id) SELECT $1, unnest($2::bigint[]) ON CONFLICT DO NOTHING`,
      [productId, categoryIds],
    );
}

export async function addImages(db: Db, productId: string, images: { url: string; position: number; publicId?: string }[]) {
  await db.query(
    `INSERT INTO product_images (product_id, url, position, public_id)
     SELECT $1, u, p, pid FROM unnest($2::text[], $3::int[], $4::text[]) AS t(u, p, pid)`,
    [productId, images.map((i) => i.url), images.map((i) => i.position), images.map((i) => i.publicId ?? null)],
  );
}

export async function addImage(db: Db, productId: string, url: string, position?: number, publicId?: string) {
  const { rows } = await db.query(
    `INSERT INTO product_images (product_id, url, position, public_id)
     VALUES ($1, $2, COALESCE($3, (SELECT COALESCE(MAX(position) + 1, 0) FROM product_images WHERE product_id = $1)), $4)
     RETURNING id, url, position`,
    [productId, url, position ?? null, publicId ?? null],
  );
  return rows[0];
}

// Returns the removed row's public_id ("" if it had none) so the caller can delete the stored file; undefined = no such image.
export async function deleteImage(db: Db, productId: string, imageId: string): Promise<string | undefined> {
  const { rows } = await db.query(`DELETE FROM product_images WHERE id = $1 AND product_id = $2 RETURNING COALESCE(public_id, '') AS "publicId"`, [imageId, productId]);
  return rows[0]?.publicId;
}

// ---- bulk import helpers: one statement per table, arrays expanded with unnest ----
export async function upsertNames(db: Db, table: "manufacturers" | "categories", names: string[], slugs?: string[]) {
  const sql =
    table === "manufacturers"
      ? `INSERT INTO manufacturers (name) SELECT unnest($1::text[])
         ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id, name`
      : `INSERT INTO categories (name, slug) SELECT * FROM unnest($1::text[], $2::text[])
         ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id, name`;
  const { rows } = await db.query(sql, table === "manufacturers" ? [names] : [names, slugs]);
  return new Map<string, string>(rows.map((r) => [r.name, r.id]));
}

export async function upsertProducts(
  db: Db,
  rows: { externalId: string; sku: string; name: string; slug: string; description: string; price: number; manufacturerId: string | null }[],
) {
  const col = <K extends keyof (typeof rows)[number]>(k: K) => rows.map((r) => r[k]);
  const res = await db.query(
    `INSERT INTO products (external_id, sku, name, slug, description, price, manufacturer_id)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::numeric[], $7::bigint[])
     ON CONFLICT (external_id) DO UPDATE
       SET name = EXCLUDED.name, description = EXCLUDED.description, price = EXCLUDED.price,
           manufacturer_id = EXCLUDED.manufacturer_id, updated_at = now()
     RETURNING id, external_id AS "externalId", (xmax = 0) AS inserted`, // xmax = 0 -> row was inserted, not updated
    [col("externalId"), col("sku"), col("name"), col("slug"), col("description"), col("price"), col("manufacturerId")],
  );
  return res.rows as { id: string; externalId: string; inserted: boolean }[];
}

export async function linkCategories(db: Db, productIds: string[], categoryIds: string[]) {
  await db.query(
    `INSERT INTO product_categories (product_id, category_id) SELECT * FROM unnest($1::bigint[], $2::bigint[]) ON CONFLICT DO NOTHING`,
    [productIds, categoryIds],
  );
}

export async function replaceImages(db: Db, images: { productId: string; url: string; position: number }[], productIds: string[]) {
  await db.query(`DELETE FROM product_images WHERE product_id = ANY($1::bigint[])`, [productIds]);
  if (images.length)
    await db.query(
      `INSERT INTO product_images (product_id, url, position) SELECT * FROM unnest($1::bigint[], $2::text[], $3::int[])`,
      [images.map((i) => i.productId), images.map((i) => i.url), images.map((i) => i.position)],
    );
}
