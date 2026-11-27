import type { Request, Response } from "express";
import { idParam } from "../../utils/validation";
import * as svc from "./inventory.service";
import { adjustSchema, historyQuerySchema, listQuerySchema, reserveSchema, setStockSchema, thresholdSchema } from "./inventory.types";

const uid = (req: Request) => req.user!.sub;
const pid = (req: Request) => idParam.parse(req.params.productId);

export async function reserve(req: Request, res: Response) {
  const { items } = reserveSchema.parse(req.body);
  res.status(201).json({ success: true, data: await svc.reserve(items, uid(req)) });
}

export async function release(req: Request, res: Response) {
  const isAdmin = !!req.user!.roles.some((r) => r === "ADMIN" || r === "SUPER_ADMIN");
  res.json({ success: true, data: await svc.release(idParam.parse(req.params.id), { id: uid(req), isAdmin }) });
}

export async function list(req: Request, res: Response) {
  const { items, meta } = await svc.list(listQuerySchema.parse(req.query));
  res.json({ success: true, data: items, meta });
}

export const getOne = async (req: Request, res: Response) => res.json({ success: true, data: await svc.getOne(pid(req)) });

export async function history(req: Request, res: Response) {
  const { page, limit } = historyQuerySchema.parse(req.query);
  const { items, meta } = await svc.history(pid(req), page, limit);
  res.json({ success: true, data: items, meta });
}

export const adjust = async (req: Request, res: Response) => res.json({ success: true, data: await svc.adjust(pid(req), adjustSchema.parse(req.body), uid(req)) });

export async function setStock(req: Request, res: Response) {
  const { quantity, note } = setStockSchema.parse(req.body);
  res.json({ success: true, data: await svc.setStock(pid(req), quantity, note, uid(req)) });
}

export const setThreshold = async (req: Request, res: Response) =>
  res.json({ success: true, data: await svc.setThreshold(pid(req), thresholdSchema.parse(req.body).lowStockThreshold) });
