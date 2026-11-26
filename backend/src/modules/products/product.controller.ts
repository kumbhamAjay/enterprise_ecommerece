import type { Request, Response } from "express";
import { tagCache } from "../../utils/cache";
import { idParam } from "../../utils/validation";
import * as svc from "./product.service";
import { createProductSchema, importSchema, imageSchema, listQuerySchema, updateProductSchema } from "./product.types";

export async function list(req: Request, res: Response) {
  const { items, meta } = await svc.list(listQuerySchema.parse(req.query));
  tagCache(res);
  res.json({ success: true, data: items, meta });
}

export async function get(req: Request, res: Response) {
  const data = await svc.get(idParam.parse(req.params.id));
  tagCache(res);
  res.json({ success: true, data });
}

export const create = async (req: Request, res: Response) =>
  res.status(201).json({ success: true, data: await svc.create(createProductSchema.parse(req.body), req.user!.sub) });

export const update = async (req: Request, res: Response) =>
  res.json({ success: true, data: await svc.update(idParam.parse(req.params.id), updateProductSchema.parse(req.body)) });

export async function deactivate(req: Request, res: Response) {
  await svc.deactivate(idParam.parse(req.params.id));
  res.status(204).end();
}

export async function addImage(req: Request, res: Response) {
  const { url, position, publicId } = imageSchema.parse(req.body);
  res.status(201).json({ success: true, data: await svc.addImage(idParam.parse(req.params.id), url, position, publicId) });
}

export async function deleteImage(req: Request, res: Response) {
  await svc.deleteImage(idParam.parse(req.params.id), idParam.parse(req.params.imageId));
  res.status(204).end();
}

export async function importProducts(req: Request, res: Response) {
  const { limit } = importSchema.parse(req.body ?? {});
  res.json({ success: true, data: await svc.importFromDummyJson(limit) });
}
