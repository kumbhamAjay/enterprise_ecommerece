import { z } from "zod";
import { pool, withTransaction } from "../../config/db";
import { HttpError } from "../../utils/httpError";
import { destroyAsset, isOurAsset } from "../../config/cloudinary";
import { afterWrite, cached, catalogKey, hashOf } from "../../utils/cache";
import { slugify } from "../../utils/slug";
import * as inventory from "../inventory/inventory.repository";
import * as repo from "./product.repository";
import type { CreateProductInput, ListQuery, UpdateProductInput } from "./product.types";

const notFound = () => new HttpError(404, "Product not found");

// Reads are cache-aside. Stock badges inside these responses can lag by up to the TTL: browsing may be slightly stale,
// but carts, checkout and reservations always read the database, so correctness never depends on this cache.
export async function list(q: ListQuery) {
  return cached(await catalogKey(`products:list:${hashOf(q)}`), 60, async () => {
    const { items, total } = await repo.listProducts(pool, q);
    return { items, meta: { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) } };
  });
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
