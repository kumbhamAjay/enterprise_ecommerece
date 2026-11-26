import type { Request, Response } from "express";
import { tagCache } from "../../utils/cache";
import { idParam } from "../../utils/validation";
import * as svc from "./manufacturer.service";
import { manufacturerSchema } from "./manufacturer.types";

export async function list(_req: Request, res: Response) {
  const data = await svc.list();
  tagCache(res);
  res.json({ success: true, data });
}
export const get = async (req: Request, res: Response) => res.json({ success: true, data: await svc.get(idParam.parse(req.params.id)) });
export const create = async (req: Request, res: Response) =>
  res.status(201).json({ success: true, data: await svc.create(manufacturerSchema.parse(req.body).name) });
export const update = async (req: Request, res: Response) =>
  res.json({ success: true, data: await svc.update(idParam.parse(req.params.id), manufacturerSchema.parse(req.body).name) });
export const remove = async (req: Request, res: Response) => {
  await svc.remove(idParam.parse(req.params.id));
  res.status(204).end();
};
