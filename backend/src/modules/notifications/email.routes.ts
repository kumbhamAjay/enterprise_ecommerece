import { Router } from "express";
import { z } from "zod";
import { authenticate, requireRole } from "../../middlewares/authenticate";
import { idParam } from "../../utils/validation";
import * as svc from "./email.service";

// /api/admin/emails
export const adminEmailRoutes = Router();
adminEmailRoutes.use(authenticate, requireRole("ADMIN", "SUPER_ADMIN"));

adminEmailRoutes.get("/", async (req, res) => {
  const q = z.object({
    status: z.enum(["PENDING", "SENT", "FAILED"]).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(15),
  }).parse(req.query);
  const { items, meta } = await svc.list(q);
  res.json({ success: true, data: items, meta });
});
adminEmailRoutes.get("/stats", async (_req, res) => res.json({ success: true, data: await svc.stats() }));
adminEmailRoutes.post("/:id/retry", async (req, res) => {
  await svc.retry(idParam.parse(req.params.id));
  res.json({ success: true });
});
