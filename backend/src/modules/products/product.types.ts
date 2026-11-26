import { z } from "zod";
import { PUBLIC_ID_PATTERN } from "../../config/cloudinary";
import { idParam } from "../../utils/validation";

const slug = z.string().trim().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "lowercase letters, digits and dashes").max(300);

export const createProductSchema = z.object({
  sku: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(255),
  slug: slug.optional(), // defaults to slugify(name)
  description: z.string().trim().max(10_000).optional(),
  price: z.number().min(0).max(1_000_000_000), // stored as numeric(12,2), returned as a string
  manufacturerId: idParam.nullable().optional(),
  categoryIds: z.array(idParam).max(50).optional(),
  images: z.array(z.object({ url: z.url(), publicId: z.string().regex(PUBLIC_ID_PATTERN).optional() })).max(20).optional(),
  isActive: z.boolean().optional(),
  stock: z.number().int().min(0).max(1_000_000).optional(), // initial stock; later changes go through /api/inventory
});
// Images have their own endpoints; on update categoryIds REPLACES the whole set.
export const updateProductSchema = createProductSchema.omit({ images: true, stock: true }).partial();

export const imageSchema = z.object({ url: z.url(), position: z.number().int().min(0).optional(), publicId: z.string().regex(PUBLIC_ID_PATTERN).optional() });

export const listQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  categoryId: idParam.optional(), // includes all descendant categories
  manufacturerId: idParam.optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  inStock: z.literal("true").optional(), // hide sold-out products
  sort: z.enum(["relevance", "newest", "price_asc", "price_desc", "name"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(600).optional(), // opaque; from meta.nextCursor of the previous page (keyset pagination)
});

export const importSchema = z.object({ limit: z.number().int().min(1).max(100).default(30) });

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ListQuery = z.infer<typeof listQuerySchema>;
