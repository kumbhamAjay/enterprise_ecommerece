import { Router } from "express";
import { authenticate, requireRole } from "../../middlewares/authenticate";
import * as c from "./analytics.controller";

// /api/admin/analytics
export const adminAnalyticsRoutes = Router();
adminAnalyticsRoutes.use(authenticate, requireRole("ADMIN", "SUPER_ADMIN"));
adminAnalyticsRoutes.get("/summary", c.summary);
adminAnalyticsRoutes.get("/revenue", c.revenue);
adminAnalyticsRoutes.get("/top-products", c.topProducts);
adminAnalyticsRoutes.get("/top-customers", c.topCustomers);
adminAnalyticsRoutes.post("/refresh", c.refresh);
