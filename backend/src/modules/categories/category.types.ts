import { z } from "zod";
import { idParam } from "../../utils/validation";

export const categorySchema = z.object({
  name: z.string().trim().min(1).max(150),
  slug: z.string().trim().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "lowercase letters, digits and dashes").max(160).optional(),
  parentId: idParam.nullable().optional(), // null / omitted = top-level
});
export const updateCategorySchema = categorySchema.partial();

export type CategoryInput = z.infer<typeof categorySchema>;
