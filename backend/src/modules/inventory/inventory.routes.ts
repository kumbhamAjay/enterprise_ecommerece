import { Router } from "express";
import { authenticate, requireRole } from "../../middlewares/authenticate";
import * as c from "./inventory.controller";

const router = Router();
router.use(authenticate);

// Any signed-in customer (the cart will call these in Module 4)
router.post("/reservations", c.reserve);
router.delete("/reservations/:id", c.release);

// Admin only
router.use(requireRole("ADMIN", "SUPER_ADMIN"));
router.get("/", c.list);
router.get("/:productId", c.getOne);
router.get("/:productId/history", c.history);
router.post("/:productId/adjust", c.adjust);
router.put("/:productId/stock", c.setStock);
router.patch("/:productId", c.setThreshold);

export default router;
