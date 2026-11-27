import type { Request, Response } from "express";
import * as svc from "./admin-user.service";
import { idParam, listQuery, rolesBody, statusBody } from "./admin-user.types";

const actor = (req: Request) => ({ id: req.user!.sub, roles: req.user!.roles });

export async function list(req: Request, res: Response) {
  const { page, limit, ...f } = listQuery.parse(req.query);
  const r = await svc.list(f, page, limit);
  res.json({ success: true, data: r.items, meta: r.meta });
}
export async function get(req: Request, res: Response) { res.json({ success: true, data: await svc.detail(idParam.parse(req.params).id) }); }
export async function setStatus(req: Request, res: Response) {
  res.json({ success: true, data: await svc.setStatus(actor(req), idParam.parse(req.params).id, statusBody.parse(req.body).isActive) });
}
export async function setRoles(req: Request, res: Response) {
  res.json({ success: true, data: await svc.setRoles(actor(req), idParam.parse(req.params).id, rolesBody.parse(req.body).roles) });
}
