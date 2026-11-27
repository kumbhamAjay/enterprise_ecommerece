import type { Request, Response } from "express";
import * as svc from "./analytics.service";
import { rangeSchema, revenueQuery, topCustomersQuery, topProductsQuery } from "./analytics.types";

const ok = (res: Response, data: unknown) => res.json({ success: true, data });

export async function summary(req: Request, res: Response) { ok(res, await svc.summary(rangeSchema.parse(req.query))); }
export async function revenue(req: Request, res: Response) { ok(res, await svc.revenue(rangeSchema.parse(req.query), revenueQuery.parse(req.query).interval)); }
export async function topProducts(req: Request, res: Response) {
  const q = topProductsQuery.parse(req.query);
  ok(res, await svc.topProducts(rangeSchema.parse(req.query), q.limit, q.minUnits));
}
export async function topCustomers(req: Request, res: Response) {
  const q = topCustomersQuery.parse(req.query);
  ok(res, await svc.topCustomers(rangeSchema.parse(req.query), q.limit, q.minOrders));
}
export async function refresh(_req: Request, res: Response) {
  await svc.refreshSales();
  res.json({ success: true, message: "Sales report refreshed" });
}
