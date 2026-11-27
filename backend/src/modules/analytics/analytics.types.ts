import { z } from "zod";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").refine((s) => !Number.isNaN(Date.parse(s + "T00:00:00Z")), "Invalid date");
const iso = (d: Date) => d.toISOString().slice(0, 10);

// Reports cover [from, to] inclusive, in UTC days. Default: the last 30 days. Capped at a year so a report can't scan the world.
export const rangeSchema = z
  .object({ from: day.optional(), to: day.optional() })
  .transform(({ from, to }) => {
    const end = to ?? iso(new Date());
    return { from: from ?? iso(new Date(Date.parse(end + "T00:00:00Z") - 29 * 86_400_000)), to: end };
  })
  .refine((r) => r.from <= r.to, { message: "from must not be after to" })
  .refine((r) => Date.parse(r.to) - Date.parse(r.from) <= 365 * 86_400_000, { message: "The range can be at most one year" });

export const revenueQuery = z.object({ interval: z.enum(["day", "week", "month"]).default("day") });
export const topProductsQuery = z.object({ limit: z.coerce.number().int().min(1).max(50).default(10), minUnits: z.coerce.number().int().min(1).default(1) });
export const topCustomersQuery = z.object({ limit: z.coerce.number().int().min(1).max(50).default(10), minOrders: z.coerce.number().int().min(1).default(1) });

export type Range = z.infer<typeof rangeSchema>;
