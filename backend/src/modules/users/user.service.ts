import bcrypt from "bcrypt";
import { pool, withTransaction } from "../../config/db";
import { HttpError } from "../../utils/httpError";
import { revokeAccessTokens } from "../../utils/revocation";
import { revokeAllForUser, setPasswordHash } from "../auth/auth.repository";
import * as repo from "./user.repository";
import type { AddressInput } from "./user.types";

export const updateProfile = (id: string, p: { firstName?: string; lastName?: string }) => repo.updateProfile(pool, id, p);

export async function changePassword(id: string, currentPassword: string, newPassword: string) {
  const hash = await repo.getPasswordHash(pool, id);
  if (!hash || !(await bcrypt.compare(currentPassword, hash))) throw new HttpError(400, "Current password is incorrect");
  const newHash = await bcrypt.hash(newPassword, 12);
  await withTransaction(async (db) => {
    await setPasswordHash(db, id, newHash);
    await revokeAllForUser(db, id); // other devices must log in again
  });
  await revokeAccessTokens(id);
}

export const listAddresses = (userId: string) => repo.listAddresses(pool, userId);

// Setting a new default = unset the old one + write the new one, atomically.
export const createAddress = (userId: string, a: AddressInput) =>
  withTransaction(async (db) => {
    if (a.isDefault) await repo.clearDefault(db, userId);
    return repo.insertAddress(db, userId, a);
  });

export const updateAddress = (id: string, userId: string, a: Partial<AddressInput>) =>
  withTransaction(async (db) => {
    if (a.isDefault) await repo.clearDefault(db, userId);
    const row = await repo.updateAddress(db, id, userId, a);
    if (!row) throw new HttpError(404, "Address not found"); // rollback restores the old default
    return row;
  });

export async function deleteAddress(id: string, userId: string) {
  if (!(await repo.deleteAddress(pool, id, userId))) throw new HttpError(404, "Address not found");
}
