import { Router } from "express";
import { authenticate, requireRole } from "../../middlewares/authenticate";
import * as c from "./admin-user.controller";

// /api/admin/users  (admins manage customers; role changes and staff accounts need SUPER_ADMIN, enforced in the service)
export const adminUserRoutes = Router();
adminUserRoutes.use(authenticate, requireRole("ADMIN", "SUPER_ADMIN"));
adminUserRoutes.get("/", c.list);
adminUserRoutes.get("/:id", c.get);
adminUserRoutes.patch("/:id/status", c.setStatus);
adminUserRoutes.put("/:id/roles", c.setRoles);
