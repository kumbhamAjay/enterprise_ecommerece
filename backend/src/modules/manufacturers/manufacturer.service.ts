import { pool } from "../../config/db";
import { afterWrite, cached, catalogKey } from "../../utils/cache";
import { HttpError } from "../../utils/httpError";
import * as repo from "./manufacturer.repository";

const found = <T>(row: T | undefined): T => {
  if (!row) throw new HttpError(404, "Manufacturer not found");
  return row;
};

export const list = async () => cached(await catalogKey("manufacturers"), 600, () => repo.list(pool));
export const get = async (id: string) => found(await repo.get(pool, id));
const createRaw = (name: string) => repo.insert(pool, name);
const updateRaw = async (id: string, name: string) => found(await repo.update(pool, id, name));
const removeRaw = async (id: string) => {
  if (!(await repo.remove(pool, id))) throw new HttpError(404, "Manufacturer not found"); // products keep existing, manufacturer_id -> NULL
};

export const create = afterWrite(createRaw);
export const update = afterWrite(updateRaw);
export const remove = afterWrite(removeRaw);
