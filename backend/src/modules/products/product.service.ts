import { z } from "zod";
import { pool, withTransaction } from "../../config/db";
import { HttpError } from "../../utils/httpError";
import { destroyAsset, isOurAsset } from "../../config/cloudinary";
import { afterWrite, cached, catalogKey, hashOf } from "../../utils/cache";
import { slugify } from "../../utils/slug";
import * as inventory from "../inventory/inventory.repository";
import * as repo from "./product.repository";
import { KEYSET, type KeysetSort } from "./product.repository";
import type { CreateProductInput, ListQuery, UpdateProductInput } from "./product.types";

const notFound = () => new HttpError(404, "Product not found");

// Reads are cache-aside. Stock badges inside these responses can lag by up to the TTL: browsing may be slightly stale,
// but carts, checkout and reservations always read the database, so correctness never depends on this cache.
const COUNT_CAP = 10_000; // totals are exact up to here, then "10,000+" (counting a million rows just to print a number is waste)
const MAX_OFFSET = 10_000; // page-number navigation stops here; beyond it clients use the cursor
const RELEVANCE_MAX = 1_000; // relevance results are reachable up to here

// The cursor remembers WHERE the last page ended (sort + last row's values) and a hash of the filters it belongs to,
// so a cursor can't be replayed against a different search.
type Cursor = { s: KeysetSort | "relevance"; v?: [string, string]; o?: number; h: string };
const encodeCursor = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString("base64url");
function decodeCursor(raw: string, h: string): Cursor {
  try {
    const c = JSON.parse(Buffer.from(raw, "base64url").toString()) as Cursor;
    const okSort = c.s === "relevance" || c.s in KEYSET;
    if (!okSort || c.h !== h || (c.s === "relevance" ? !Number.isInteger(c.o) || c.o! < 0 : !Array.isArray(c.v) || c.v.length !== 2)) throw new Error();
    return c;
  } catch {
    throw new HttpError(400, "Invalid cursor");
  }
}

export async function list(q: ListQuery) {
  return cached(await catalogKey(`products:list:${hashOf(q)}`), 60, () => listUncached(q));
}

async function listUncached(q: ListQuery) {
  const categoryIds = q.categoryId ? await cached(await catalogKey(`categories:desc:${q.categoryId}`), 600, () => repo.descendantCategoryIds(pool, q.categoryId!)) : undefined;
  const f = repo.buildFilters(q, categoryIds);
  const h = hashOf({ q: q.q, c: q.categoryId, m: q.manufacturerId, lo: q.minPrice, hi: q.maxPrice, st: q.inStock });
  const requested = q.sort ?? (q.q ? "relevance" : "newest");

  let sort: KeysetSort | "relevance";
  let total: number | null = null;
  let capped = false;
  let after: [string, string] | undefined;
  let offset = 0;
  const cursor = q.cursor ? decodeCursor(q.cursor, h) : undefined;

  if (cursor) {
    sort = cursor.s; // continuing: the first page already decided the sort and counted, so this request does neither
    if (cursor.s === "relevance") offset = cursor.o!;
    else after = cursor.v;
  } else {
    const n = await repo.countBounded(pool, f, COUNT_CAP + 1);
    capped = n > COUNT_CAP;
    total = Math.min(n, COUNT_CAP);
    // Ranking needs every match's text; for a huge match set (one very common word) that is the slowest thing we can ask of
    // Postgres. Past the cap we order by newest instead: bounded cost, and ranking among 10,000+ near-identical hits means little.
    sort = requested === "relevance" && (!q.q || capped) ? "newest" : requested;
    offset = (q.page - 1) * q.limit;
    if (offset + q.limit > (sort === "relevance" ? RELEVANCE_MAX : MAX_OFFSET))
      throw new HttpError(400, "That page is too deep. Use the cursor from the previous page, or narrow your search.");
  }

  const rows = await repo.listRows(pool, f, { sort, after, offset, limit: q.limit }).catch((e) => {
    if (["22P02", "22007", "22003", "22001"].includes(e?.code)) throw new HttpError(400, "Invalid cursor"); // a tampered cursor value failed to cast
    throw e;
  });
  const hasMore = rows.length > q.limit;
  const page = rows.slice(0, q.limit);
  const last = page.at(-1);
  let nextCursor: string | null = null;
  if (hasMore && last) {
    if (sort === "relevance") {
      if (offset + q.limit < RELEVANCE_MAX) nextCursor = encodeCursor({ s: sort, o: offset + q.limit, h });
    } else {
      const col = KEYSET[sort].col.slice(2); // "p.price" -> "price"
      nextCursor = encodeCursor({ s: sort, v: [String(col === "created_at" ? last._created : last[col]), last.id], h });
    }
  }
  const items = page.map(({ _created, ...r }) => r);
  return {
    items,
    meta: {
      ...(cursor ? {} : { page: q.page }),
      limit: q.limit,
      total, // null on cursor requests: the client keeps the total from the first page
      totalPages: total === null ? null : Math.ceil(total / q.limit),
      totalCapped: capped,
      hasMore,
      nextCursor,
      sortedBy: sort, // tells the client if relevance fell back to newest
    },
  };
}

export async function get(id: string) {
  return cached(await catalogKey(`products:${id}`), 120, async () => {
    const p = await repo.getProduct(pool, id, true);
    if (!p) throw notFound(); // errors are not cached
    return p;
  });
}

const assertOurs = (images: { url: string; publicId?: string }[] = []) => {
  for (const i of images) if (i.publicId && !isOurAsset(i.url, i.publicId)) throw new HttpError(400, "That image doesn’t belong to our media library");
};

const createRaw = ({ categoryIds, images, stock, ...p }: CreateProductInput, actorId: string) => {
  assertOurs(images);
  return withTransaction(async (db) => {
    const id = await repo.insertProduct(db, { ...p, slug: p.slug ?? slugify(p.name) });
    await inventory.createInitial(db, id, stock ?? 0, actorId); // every product has an inventory row from day one
    if (categoryIds?.length) await repo.setCategories(db, id, categoryIds);
    if (images?.length) await repo.addImages(db, id, images.map((i, position) => ({ url: i.url, position, publicId: i.publicId })));
    return repo.getProduct(db, id, false);
  });
};

const updateRaw = (id: string, { categoryIds, ...fields }: UpdateProductInput) =>
  withTransaction(async (db) => {
    if (!(await repo.updateProduct(db, id, fields))) throw notFound();
    if (categoryIds) await repo.setCategories(db, id, categoryIds);
    return repo.getProduct(db, id, false);
  });

// Soft delete: order history must keep pointing at the product row.
async function deactivateRaw(id: string) {
  if (!(await repo.updateProduct(pool, id, { isActive: false }))) throw notFound();
}

async function addImageRaw(productId: string, url: string, position?: number, publicId?: string) {
  assertOurs([{ url, publicId }]);
  if (!(await repo.getProduct(pool, productId, false))) throw notFound();
  return repo.addImage(pool, productId, url, position, publicId);
}

async function deleteImageRaw(productId: string, imageId: string) {
  const publicId = await repo.deleteImage(pool, productId, imageId);
  if (publicId === undefined) throw new HttpError(404, "Image not found");
  await destroyAsset(publicId); // also remove the stored file (best-effort)
}

// ---------------- bulk import from DummyJSON (idempotent UPSERT) ----------------
const dummySchema = z.object({
  products: z.array(
    z.object({
      id: z.number(),
      title: z.string(),
      description: z.string(),
      category: z.string(),
      price: z.number(),
      brand: z.string().optional(),
      sku: z.string(),
      stock: z.number().int().min(0).default(0),
      images: z.array(z.string()),
    }),
  ),
});

async function importRaw(limit: number) {
  const res = await fetch(`https://dummyjson.com/products?limit=${limit}&select=id,title,description,category,price,brand,sku,stock,images`, {
    signal: AbortSignal.timeout(10_000),
  }).catch((e) => {
    console.error("product import fetch failed:", e);
    return undefined;
  });
  if (res?.status === 429) throw new HttpError(503, `Product source is rate limiting, retry in ${res.headers.get("retry-after") ?? "a few"}s`);
  if (!res?.ok) throw new HttpError(502, "Product source unavailable");
  const parsed = dummySchema.safeParse(await res.json());
  if (!parsed.success) throw new HttpError(502, "Unexpected response from product source");
  const items = parsed.data.products;

  return withTransaction(async (db) => {
    // dedupe first: ON CONFLICT DO UPDATE can't touch the same row twice in one statement
    const brands = [...new Set(items.flatMap((i) => (i.brand ? [i.brand] : [])))];
    const cats = [...new Set(items.map((i) => i.category))];
    const brandIds = brands.length ? await repo.upsertNames(db, "manufacturers", brands) : new Map<string, string>();
    const catIds = await repo.upsertNames(db, "categories", cats, cats.map(slugify));

    const rows = await repo.upsertProducts(
      db,
      items.map((i) => ({
        externalId: `dummyjson:${i.id}`,
        sku: i.sku,
        name: i.title,
        slug: `${slugify(i.title)}-${i.id}`,
        description: i.description,
        price: i.price,
        manufacturerId: i.brand ? brandIds.get(i.brand) ?? null : null,
      })),
    );
    const idOf = new Map(rows.map((r) => [r.externalId, r.id]));
    await inventory.createInitialBulk(db, items.map((i) => idOf.get(`dummyjson:${i.id}`)!), items.map((i) => i.stock)); // existing counts are never overwritten

    await repo.linkCategories(db, items.map((i) => idOf.get(`dummyjson:${i.id}`)!), items.map((i) => catIds.get(i.category)!));
    await repo.replaceImages(
      db,
      items.flatMap((i) => i.images.map((url, position) => ({ productId: idOf.get(`dummyjson:${i.id}`)!, url, position }))),
      rows.map((r) => r.id),
    );
    const inserted = rows.filter((r) => r.inserted).length;
    return { inserted, updated: rows.length - inserted };
  });
}

// Every write invalidates the catalog cache once it has committed.
export const create = afterWrite(createRaw);
export const update = afterWrite(updateRaw);
export const deactivate = afterWrite(deactivateRaw);
export const addImage = afterWrite(addImageRaw);
export const deleteImage = afterWrite(deleteImageRaw);
export const importFromDummyJson = afterWrite(importRaw);
