import type { Request, Response } from "express";
import * as svc from "./user.service";
import { addressSchema, changePasswordSchema, idParam, updateAddressSchema, updateProfileSchema } from "./user.types";

const uid = (req: Request) => req.user!.sub;

export async function updateProfile(req: Request, res: Response) {
  res.json({ success: true, data: await svc.updateProfile(uid(req), updateProfileSchema.parse(req.body)) });
}

export async function changePassword(req: Request, res: Response) {
  const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
  await svc.changePassword(uid(req), currentPassword, newPassword);
  res.json({ success: true, message: "Password changed. Please log in again." });
}

export async function listAddresses(req: Request, res: Response) {
  res.json({ success: true, data: await svc.listAddresses(uid(req)) });
}

export async function createAddress(req: Request, res: Response) {
  res.status(201).json({ success: true, data: await svc.createAddress(uid(req), addressSchema.parse(req.body)) });
}

export async function updateAddress(req: Request, res: Response) {
  const data = await svc.updateAddress(idParam.parse(req.params.id), uid(req), updateAddressSchema.parse(req.body));
  res.json({ success: true, data });
}

export async function deleteAddress(req: Request, res: Response) {
  await svc.deleteAddress(idParam.parse(req.params.id), uid(req));
  res.status(204).end();
}
