import type { Db } from "../auth/auth.repository";

export const list = async (db: Db) => (await db.query(`SELECT id, name FROM manufacturers ORDER BY name`)).rows;
export const get = async (db: Db, id: string) => (await db.query(`SELECT id, name FROM manufacturers WHERE id = $1`, [id])).rows[0];
export const insert = async (db: Db, name: string) =>
  (await db.query(`INSERT INTO manufacturers (name) VALUES ($1) RETURNING id, name`, [name])).rows[0];
export const update = async (db: Db, id: string, name: string) =>
  (await db.query(`UPDATE manufacturers SET name = $2 WHERE id = $1 RETURNING id, name`, [id, name])).rows[0];
export const remove = async (db: Db, id: string) => ((await db.query(`DELETE FROM manufacturers WHERE id = $1`, [id])).rowCount ?? 0) > 0;
