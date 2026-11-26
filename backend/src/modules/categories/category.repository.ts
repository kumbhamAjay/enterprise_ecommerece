import type { Db } from "../auth/auth.repository";
import { buildSet } from "../../utils/sql";

const COLS = `id, name, slug, parent_id AS "parentId"`;

export const list = async (db: Db) => (await db.query(`SELECT ${COLS} FROM categories ORDER BY name`)).rows;
export const get = async (db: Db, id: string) => (await db.query(`SELECT ${COLS} FROM categories WHERE id = $1`, [id])).rows[0];

export const insert = async (db: Db, c: { name: string; slug: string; parentId?: string | null }) =>
  (await db.query(`INSERT INTO categories (name, slug, parent_id) VALUES ($1, $2, $3) RETURNING ${COLS}`, [c.name, c.slug, c.parentId ?? null])).rows[0];

export async function update(db: Db, id: string, input: Record<string, unknown>) {
  const params: unknown[] = [id];
  const sets = buildSet({ name: "name", slug: "slug", parentId: "parent_id" }, input, params);
  if (!sets.length) return get(db, id);
  return (await db.query(`UPDATE categories SET ${sets.join(", ")} WHERE id = $1 RETURNING ${COLS}`, params)).rows[0];
}

export const remove = async (db: Db, id: string) => ((await db.query(`DELETE FROM categories WHERE id = $1`, [id])).rowCount ?? 0) > 0;
