import { z } from "zod";
import { idParam } from "../../utils/validation";

export const MAX_PER_LINE = 20;
const qty = z.number().int().min(1).max(MAX_PER_LINE);

export const addItemSchema = z.object({ productId: idParam, quantity: qty.default(1) });
export const setQuantitySchema = z.object({ quantity: qty });
export const mergeSchema = z.object({ items: z.array(z.object({ productId: idParam, quantity: qty })).min(1).max(50) });

export type CartIssue = "UNAVAILABLE" | "OUT_OF_STOCK" | "INSUFFICIENT_STOCK";
