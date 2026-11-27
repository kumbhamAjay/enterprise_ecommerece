import { z } from "zod";
import { idParam } from "../../utils/validation";

export const reserveSchema = z.object({
  items: z.array(z.object({ productId: idParam, quantity: z.number().int().min(1).max(100) })).min(1).max(20),
});

export const adjustSchema = z
  .object({
    delta: z.number().int().min(-1_000_000).max(1_000_000),
    type: z.enum(["RESTOCK", "CORRECTION", "DAMAGED", "RETURN"]),
    note: z.string().trim().max(500).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.delta === 0) ctx.addIssue({ code: "custom", path: ["delta"], message: "Delta can’t be zero" });
    if ((v.type === "RESTOCK" || v.type === "RETURN") && v.delta < 0) ctx.addIssue({ code: "custom", path: ["delta"], message: `${v.type} must add stock (positive delta)` });
    if (v.type === "DAMAGED" && v.delta > 0) ctx.addIssue({ code: "custom", path: ["delta"], message: "DAMAGED must remove stock (negative delta)" });
  });

export const setStockSchema = z.object({ quantity: z.number().int().min(0).max(1_000_000), note: z.string().trim().max(500).optional() });
export const thresholdSchema = z.object({ lowStockThreshold: z.number().int().min(0).max(1_000_000) });

export const listQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  lowStock: z.literal("true").optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export const historyQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ReserveItem = z.infer<typeof reserveSchema>["items"][number];
export type AdjustInput = z.infer<typeof adjustSchema>;
export type ListQuery = z.infer<typeof listQuerySchema>;
export type TxnType = "INITIAL" | "RESTOCK" | "CORRECTION" | "DAMAGED" | "RETURN" | "RESERVE" | "RELEASE" | "EXPIRE" | "SALE";
