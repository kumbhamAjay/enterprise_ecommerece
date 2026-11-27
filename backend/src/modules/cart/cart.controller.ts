import type { Request, Response } from "express";
import { idParam } from "../../utils/validation";
import * as svc from "./cart.service";
import { addItemSchema, mergeSchema, setQuantitySchema } from "./cart.types";

const uid = (req: Request) => req.user!.sub;

export const get = async (req: Request, res: Response) => res.json({ success: true, data: await svc.getCart(uid(req)) });

export async function addItem(req: Request, res: Response) {
  const { productId, quantity } = addItemSchema.parse(req.body);
  res.status(201).json({ success: true, data: await svc.addItem(uid(req), productId, quantity) });
}

export async function setQuantity(req: Request, res: Response) {
  const { quantity } = setQuantitySchema.parse(req.body);
  res.json({ success: true, data: await svc.setQuantity(uid(req), idParam.parse(req.params.productId), quantity) });
}

export const removeItem = async (req: Request, res: Response) =>
  res.json({ success: true, data: await svc.removeItem(uid(req), idParam.parse(req.params.productId)) });

export const clear = async (req: Request, res: Response) => res.json({ success: true, data: await svc.clear(uid(req)) });

export async function merge(req: Request, res: Response) {
  res.json({ success: true, data: await svc.merge(uid(req), mergeSchema.parse(req.body).items) });
}
