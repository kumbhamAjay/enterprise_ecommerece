import { pool, withTransaction } from "../../config/db";
import { HttpError } from "../../utils/httpError";
import { revokeAccessTokens } from "../../utils/revocation";
import { revokeAllForUser } from "../auth/auth.repository";
import * as repo from "./admin-user.repository";

type Actor = { id: string; roles: string[] };
const isSuper = (a: Actor) => a.roles.includes("SUPER_ADMIN");

export async function list(f: { q?: string; role?: string; status?: "active" | "disabled" }, page: number, limit: number) {
  const { rows, total } = await repo.list(pool, f, limit, (page - 1) * limit);
  return { items: rows, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

export async function detail(id: string) {
  const user = await repo.get(pool, id);
  if (!user) throw new HttpError(404, "User not found");
  const [orders, audit] = await Promise.all([repo.recentOrders(pool, id), repo.auditFor(pool, id)]);
  return { ...user, recentOrders: orders, audit };
}

// Admins manage customers; only a SUPER_ADMIN can touch another staff account. Nobody can lock themselves out.
export async function setStatus(actor: Actor, id: string, isActive: boolean) {
  if (id === actor.id) throw new HttpError(400, "You can't change your own account status");
  await withTransaction(async (db) => {
    await repo.lockUser(db, id);
    const target = await repo.lockRoles(db, id);
    if (!target) throw new HttpError(404, "User not found");
    if (!isSuper(actor) && target.roles.some((r) => r !== "CUSTOMER")) throw new HttpError(403, "Only a super admin can change a staff account");
    if (target.isActive === isActive) return; // already there: nothing to do, nothing to audit
    await repo.setActive(db, id, isActive);
    if (!isActive) await revokeAllForUser(db, id); // refresh tokens die with the account
    await repo.audit(db, actor.id, id, isActive ? "ENABLE_USER" : "DISABLE_USER", {});
  });
  if (!isActive) await revokeAccessTokens(id); // and so do access tokens already in the wild (otherwise valid up to 15 min)
  return detail(id);
}

export async function setRoles(actor: Actor, id: string, roles: string[]) {
  if (!isSuper(actor)) throw new HttpError(403, "Only a super admin can change roles");
  if (id === actor.id) throw new HttpError(400, "You can't change your own roles");
  await withTransaction(async (db) => {
    await repo.lockUser(db, id);
    const target = await repo.lockRoles(db, id);
    if (!target) throw new HttpError(404, "User not found");
    await repo.setRoles(db, id, roles);
    await repo.audit(db, actor.id, id, "SET_ROLES", { from: [...target.roles].sort(), to: [...roles].sort() });
  });
  await revokeAccessTokens(id); // the roles inside their current token are stale: force a refresh
  return detail(id);
}
