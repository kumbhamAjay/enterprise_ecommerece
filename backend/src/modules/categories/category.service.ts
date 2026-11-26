import { pool } from "../../config/db";
import { afterWrite, cached, catalogKey } from "../../utils/cache";
import { HttpError } from "../../utils/httpError";
import { slugify } from "../../utils/slug";
import * as repo from "./category.repository";
import type { CategoryInput } from "./category.types";

const found = <T>(row: T | undefined): T => {
  if (!row) throw new HttpError(404, "Category not found");
  return row;
};

export const list = async () => cached(await catalogKey("categories"), 600, () => repo.list(pool));
export const get = async (id: string) => found(await repo.get(pool, id));
const createRaw = (c: CategoryInput) => repo.insert(pool, { ...c, slug: c.slug ?? slugify(c.name) });
const updateRaw = async (id: string, c: Partial<CategoryInput>) => found(await repo.update(pool, id, c));
const removeRaw = async (id: string) => {
  // FK RESTRICT -> 409 if the category still has child categories
  if (!(await repo.remove(pool, id))) throw new HttpError(404, "Category not found");
};

export const create = afterWrite(createRaw);
export const update = afterWrite(updateRaw);
export const remove = afterWrite(removeRaw);
