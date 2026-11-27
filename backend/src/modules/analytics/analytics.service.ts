import { pool } from "../../config/db";
import * as repo from "./analytics.repository";
import type { Range } from "./analytics.types";

const DAY = 86_400_000;
const window = ({ from, to }: Range) => ({ lo: new Date(from + "T00:00:00Z"), hi: new Date(Date.parse(to + "T00:00:00Z") + DAY) });
const pct = (now: number, before: number) => (before === 0 ? null : Number((((now - before) / before) * 100).toFixed(1)));

// KPIs for the range next to the same-length range right before it, so every number has context.
export async function summary(r: Range) {
  const { lo, hi } = window(r);
  const prevLo = new Date(lo.getTime() - (hi.getTime() - lo.getTime()));
  const [cur, prev, refunds, statuses, fresh] = await Promise.all([
    repo.totals(pool, lo, hi), repo.totals(pool, prevLo, lo), repo.refunded(pool, lo, hi), repo.byStatus(pool, lo, hi), repo.newCustomers(pool, lo, hi),
  ]);
  const aov = cur.orders ? Number((cur.revenue / cur.orders).toFixed(2)) : 0;
  const prevAov = prev.orders ? prev.revenue / prev.orders : 0;
  return {
    range: r,
    revenue: { value: cur.revenue, previous: prev.revenue, changePct: pct(cur.revenue, prev.revenue) },
    orders: { value: cur.orders, previous: prev.orders, changePct: pct(cur.orders, prev.orders) },
    avgOrderValue: { value: aov, previous: Number(prevAov.toFixed(2)), changePct: pct(aov, prevAov) },
    buyers: cur.customers,
    newCustomers: fresh,
    refunded: refunds,
    ordersByStatus: statuses,
  };
}

export const revenue = async (r: Range, interval: "day" | "week" | "month") => ({ range: r, interval, series: await repo.revenueSeries(pool, r.from, r.to, interval) });
export const topProducts = (r: Range, limit: number, minUnits: number) => { const { lo, hi } = window(r); return repo.topProducts(pool, lo, hi, limit, minUnits); };
export const topCustomers = (r: Range, limit: number, minOrders: number) => { const { lo, hi } = window(r); return repo.topCustomers(pool, lo, hi, limit, minOrders); };
export const refreshSales = () => repo.refreshSales(pool);
