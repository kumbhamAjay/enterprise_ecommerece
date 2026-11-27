import type { Db } from "../auth/auth.repository";

// Every report reads the `recognised_orders` view (paid and not cancelled/refunded), so "revenue" means one thing everywhere.
// Windows are half-open [lo, hi) timestamps so a day boundary can't count an order twice.

export async function totals(db: Db, lo: Date, hi: Date) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS orders, COALESCE(sum(total), 0)::float AS revenue, count(DISTINCT user_id)::int AS customers
     FROM recognised_orders WHERE paid_at >= $1 AND paid_at < $2`,
    [lo, hi],
  );
  return rows[0] as { orders: number; revenue: number; customers: number };
}

// Funnel: how every order PLACED in the window ended up (includes unpaid, cancelled and refunded)
export async function byStatus(db: Db, lo: Date, hi: Date) {
  const { rows } = await db.query(
    `SELECT status, count(*)::int AS orders, COALESCE(sum(total), 0)::float AS total
     FROM orders WHERE placed_at >= $1 AND placed_at < $2 GROUP BY status ORDER BY orders DESC`,
    [lo, hi],
  );
  return rows;
}

export async function newCustomers(db: Db, lo: Date, hi: Date) {
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM users WHERE created_at >= $1 AND created_at < $2`, [lo, hi]);
  return rows[0].n as number;
}

export async function refunded(db: Db, lo: Date, hi: Date) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS orders, COALESCE(sum(total), 0)::float AS total FROM orders WHERE status = 'REFUNDED' AND paid_at >= $1 AND paid_at < $2`,
    [lo, hi],
  );
  return rows[0] as { orders: number; total: number };
}

// Daily series from the materialized view. generate_series + LEFT JOIN fills days with no sales with zeros (a chart needs the gaps),
// then window functions add the running total and the change versus the previous bucket.
export async function revenueSeries(db: Db, from: string, to: string, interval: "day" | "week" | "month") {
  const { rows } = await db.query(
    `WITH days AS (
       SELECT d::date AS day FROM generate_series($1::date, $2::date, interval '1 day') d
     ), daily AS (
       SELECT days.day, COALESCE(s.orders, 0) AS orders, COALESCE(s.revenue, 0) AS revenue
       FROM days LEFT JOIN sales_daily s USING (day)
     ), bucketed AS (
       SELECT date_trunc($3::text, day)::date AS bucket, sum(orders)::int AS orders, sum(revenue) AS revenue
       FROM daily GROUP BY 1
     )
     SELECT to_char(bucket, 'YYYY-MM-DD') AS bucket, orders, revenue::float AS revenue,
            sum(revenue) OVER (ORDER BY bucket)::float AS cumulative,
            round(100 * (revenue - lag(revenue) OVER w) / NULLIF(lag(revenue) OVER w, 0), 1)::float AS "growthPct"
     FROM bucketed WINDOW w AS (ORDER BY bucket) ORDER BY bucket`,
    [from, to, interval],
  );
  return rows;
}

export const refreshSales = (db: Db) => db.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY sales_daily`);

// GROUP BY + HAVING (drop one-off products) + window functions over the aggregates: rank and each product's share of revenue.
// Grouped by sku, not product_id: order_items keep their own snapshot, and product_id becomes NULL if a product is deleted.
export async function topProducts(db: Db, lo: Date, hi: Date, limit: number, minUnits: number) {
  const { rows } = await db.query(
    `SELECT rank() OVER (ORDER BY sum(oi.line_total) DESC)::int AS rank,
            oi.sku, max(oi.name) AS name, max(oi.product_id)::text AS "productId",
            sum(oi.quantity)::int AS units, count(DISTINCT oi.order_id)::int AS orders, sum(oi.line_total)::float AS revenue,
            round(100 * sum(oi.line_total) / NULLIF(sum(sum(oi.line_total)) OVER (), 0), 1)::float AS "sharePct"
     FROM order_items oi JOIN recognised_orders o ON o.id = oi.order_id
     WHERE o.paid_at >= $1 AND o.paid_at < $2
     GROUP BY oi.sku
     HAVING sum(oi.quantity) >= $4
     ORDER BY revenue DESC, units DESC, oi.sku
     LIMIT $3`,
    [lo, hi, limit, minUnits],
  );
  return rows;
}

export async function topCustomers(db: Db, lo: Date, hi: Date, limit: number, minOrders: number) {
  const { rows } = await db.query(
    `SELECT o.user_id::text AS "userId", max(o.customer_email) AS email, count(*)::int AS orders,
            sum(o.total)::float AS spend, round(avg(o.total), 2)::float AS "avgOrder", max(o.paid_at) AS "lastOrderAt"
     FROM recognised_orders o
     WHERE o.paid_at >= $1 AND o.paid_at < $2 AND o.user_id IS NOT NULL
     GROUP BY o.user_id
     HAVING count(*) >= $4
     ORDER BY spend DESC, o.user_id
     LIMIT $3`,
    [lo, hi, limit, minOrders],
  );
  return rows;
}
