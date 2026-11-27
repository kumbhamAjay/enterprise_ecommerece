import { Router } from "express";
import { authenticate, requireRole } from "../../middlewares/authenticate";
import { byUser, rateLimit } from "../../utils/rateLimit";
import * as c from "./payment.controller";

// /api/payments  (the webhook itself is mounted in app.ts, before the JSON body parser)
export const paymentRoutes = Router();
paymentRoutes.post("/orders/:id/intent", authenticate, rateLimit({ name: "pay-intent", limit: 30, windowSec: 60, key: byUser }), c.start);
paymentRoutes.post("/orders/:id/sync", authenticate, c.sync);

// /api/admin/payments
export const adminPaymentRoutes = Router();
adminPaymentRoutes.use(authenticate, requireRole("ADMIN", "SUPER_ADMIN"));
adminPaymentRoutes.post("/reconcile", c.reconcile);
