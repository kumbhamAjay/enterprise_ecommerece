import type { Request, Response } from "express";
import { HttpError } from "../../utils/httpError";
import { verifyWebhook } from "../../config/stripe";
import { idParam } from "../../utils/validation";
import * as svc from "./payment.service";

const uid = (req: Request) => req.user!.sub;

export const start = async (req: Request, res: Response) => res.json({ success: true, data: await svc.startPayment(idParam.parse(req.params.id), uid(req)) });
export const sync = async (req: Request, res: Response) => res.json({ success: true, data: await svc.syncPayment(idParam.parse(req.params.id), uid(req)) });
export const reconcile = async (_req: Request, res: Response) => res.json({ success: true, data: await svc.reconcile() });

// Mounted BEFORE express.json(): the signature is computed over the exact raw bytes Stripe sent.
export async function webhook(req: Request, res: Response) {
  const signature = req.header("stripe-signature");
  if (!signature) throw new HttpError(400, "Missing Stripe-Signature header");
  let event;
  try {
    event = verifyWebhook(req.body as Buffer, signature);
  } catch (e) {
    if (e instanceof HttpError) throw e; // not configured -> 503
    throw new HttpError(400, "Invalid signature"); // forged, tampered or stale: do not process
  }
  // 2xx = "got it, stop retrying". Any thrown error -> 500 -> Stripe redelivers with backoff (that is the retry mechanism).
  const result = await svc.processEvent(event);
  res.json({ received: true, result });
}
