import { Router } from "express";
import { authenticate, requireRole } from "../../middlewares/authenticate";
import { byUser, rateLimit } from "../../utils/rateLimit";
import * as c from "./order.controller";

// /api/checkout
export const checkoutRoutes = Router();
checkoutRoutes.use(authenticate);
checkoutRoutes.get("/preview", c.preview);
checkoutRoutes.post("/", rateLimit({ name: "checkout", limit: 20, windowSec: 60, key: byUser }), c.checkout);

// /api/orders  (the signed-in customer's own orders)
export const orderRoutes = Router();
orderRoutes.use(authenticate);
orderRoutes.get("/", c.list);
orderRoutes.get("/:id", c.get); // owner or admin
orderRoutes.post("/:id/cancel", c.cancel);

// /api/admin/orders
export const adminOrderRoutes = Router();
adminOrderRoutes.use(authenticate, requireRole("ADMIN", "SUPER_ADMIN"));
adminOrderRoutes.get("/", c.adminList);
adminOrderRoutes.get("/:id", c.get);
adminOrderRoutes.post("/:id/status", c.adminSetStatus);
