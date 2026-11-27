import type { Request, Response } from "express";
import { pool } from "../../config/db";
import { HttpError } from "../../utils/httpError";
import { findUserById } from "../auth/auth.repository";
import { idParam } from "../../utils/validation";
import { flushRefunds } from "../payments/payment.service";
import * as svc from "./order.service";
import { cancelSchema, checkoutSchema, idempotencyKeySchema, listQuerySchema, statusSchema } from "./order.types";

const uid = (req: Request) => req.user!.sub;
const isAdmin = (req: Request) => req.user!.roles.some((r) => r === "ADMIN" || r === "SUPER_ADMIN");

export const preview = async (req: Request, res: Response) => res.json({ success: true, data: await svc.previewCheckout(uid(req)) });

export async function checkout(req: Request, res: Response) {
  const raw = req.header("idempotency-key");
  if (!raw) throw new HttpError(400, "Idempotency-Key header is required");
  const key = idempotencyKeySchema.parse(raw);
  const body = checkoutSchema.parse(req.body);
  const user = await findUserById(pool, uid(req)); // the JWT carries no email; the order snapshots it
  const { order, replayed } = await svc.checkout(uid(req), user.email, body, key);
  if (replayed) res.setHeader("Idempotent-Replay", "true");
  res.status(replayed ? 200 : 201).json({ success: true, data: order });
}

export async function list(req: Request, res: Response) {
  const { items, meta } = await svc.listOrders({ ...listQuerySchema.parse(req.query), q: undefined, userId: uid(req) });
  res.json({ success: true, data: items, meta });
}

export const get = async (req: Request, res: Response) =>
  res.json({ success: true, data: await svc.getOrder(idParam.parse(req.params.id), { id: uid(req), isAdmin: isAdmin(req) }) });

export async function cancel(req: Request, res: Response) {
  const { reason } = cancelSchema.parse(req.body ?? {});
  const order = await svc.cancelByCustomer(idParam.parse(req.params.id), uid(req), reason);
  await flushRefunds(order.id).catch(() => {}); // best-effort now; the reconciler retries
  res.json({ success: true, data: await svc.getOrder(order.id, { id: uid(req), isAdmin: false }) });
}

// ---- admin ----
export async function adminList(req: Request, res: Response) {
  const { items, meta } = await svc.listOrders(listQuerySchema.parse(req.query));
  res.json({ success: true, data: items, meta });
}
export async function adminSetStatus(req: Request, res: Response) {
  const { status, note } = statusSchema.parse(req.body);
  const order = await svc.adminSetStatus(idParam.parse(req.params.id), status, uid(req), note);
  await flushRefunds(order.id).catch(() => {});
  res.json({ success: true, data: await svc.getOrder(order.id, { id: uid(req), isAdmin: true }) });
}
