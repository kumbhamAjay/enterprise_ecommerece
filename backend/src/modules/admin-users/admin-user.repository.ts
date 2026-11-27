import type { Db } from "../auth/auth.repository";

type Filters = { q?: string; role?: string; status?: "active" | "disabled" };

// Roles aggregated into an array per user; lifetime orders and spend come from the recognised_orders view via LATERAL
// (one small lookup per user ON THE PAGE, not a join over every order).
const COLS = `u.id::text AS id, u.first_name AS "firstName", u.last_name AS "lastName", u.email, u.is_active AS "isActive",
  (u.email_verified_at IS NOT NULL) AS "emailVerified", u.created_at AS "createdAt",
  COALESCE((SELECT array_agg(r.name ORDER BY r.name) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id), '{}') AS roles`;

function where(f: Filters) {
  const w: string[] = []; const p: unknown[] = [];
  if (f.q) { p.push(`%${f.q.replace(/[%_\\]/g, "\\$&")}%`); w.push(`(u.email ILIKE $${p.length} OR u.first_name ILIKE $${p.length} OR COALESCE(u.last_name, '') ILIKE $${p.length})`); }
  if (f.status) w.push(f.status === "active" ? "u.is_active" : "NOT u.is_active");
  if (f.role) { p.push(f.role); w.push(`EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.name = $${p.length})`); }
  return { sql: w.length ? "WHERE " + w.join(" AND ") : "", p };
}

export async function list(db: Db, f: Filters, limit: number, offset: number) {
  const { sql, p } = where(f);
  const total = (await db.query(`SELECT count(*)::int AS n FROM users u ${sql}`, p)).rows[0].n as number;
  const { rows } = await db.query(
    `SELECT ${COLS}, COALESCE(s.orders, 0) AS orders, COALESCE(s.spend, 0)::float AS spend
     FROM users u
     LEFT JOIN LATERAL (SELECT count(*)::int AS orders, sum(total) AS spend FROM recognised_orders o WHERE o.user_id = u.id) s ON true
     ${sql} ORDER BY u.id DESC LIMIT $${p.length + 1} OFFSET $${p.length + 2}`,
    [...p, limit, offset],
  );
  return { rows, total };
}

export async function get(db: Db, id: string) {
  const { rows } = await db.query(`SELECT ${COLS} FROM users u WHERE u.id = $1`, [id]);
  return rows[0];
}

export async function lockRoles(db: Db, id: string): Promise<{ isActive: boolean; roles: string[] } | undefined> {
  const { rows } = await db.query(
    `SELECT u.is_active AS "isActive", COALESCE(array_agg(r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles
     FROM users u LEFT JOIN user_roles ur ON ur.user_id = u.id LEFT JOIN roles r ON r.id = ur.role_id
     WHERE u.id = $1 GROUP BY u.id`,
    [id],
  );
  return rows[0];
}

export const lockUser = (db: Db, id: string) => db.query(`SELECT 1 FROM users WHERE id = $1 FOR UPDATE`, [id]);
export const setActive = (db: Db, id: string, active: boolean) => db.query(`UPDATE users SET is_active = $2, updated_at = now() WHERE id = $1`, [id, active]);

export async function setRoles(db: Db, id: string, roles: string[]) {
  await db.query(`DELETE FROM user_roles WHERE user_id = $1`, [id]);
  await db.query(`INSERT INTO user_roles (user_id, role_id) SELECT $1, r.id FROM roles r WHERE r.name = ANY($2::text[])`, [id, roles]);
}

export const audit = (db: Db, actor: string, target: string, action: string, detail: object) =>
  db.query(`INSERT INTO admin_audit_log (actor_user_id, target_user_id, action, detail) VALUES ($1, $2, $3, $4)`, [actor, target, action, detail]);

export async function recentOrders(db: Db, id: string) {
  const { rows } = await db.query(
    `SELECT id::text AS id, order_number AS "orderNumber", status, total::float AS total, placed_at AS "placedAt" FROM orders WHERE user_id = $1 ORDER BY placed_at DESC LIMIT 10`, [id]);
  return rows;
}

export async function auditFor(db: Db, id: string) {
  const { rows } = await db.query(
    `SELECT l.action, l.detail, l.created_at AS "createdAt", a.email AS "actorEmail"
     FROM admin_audit_log l LEFT JOIN users a ON a.id = l.actor_user_id WHERE l.target_user_id = $1 ORDER BY l.id DESC LIMIT 20`, [id]);
  return rows;
}
