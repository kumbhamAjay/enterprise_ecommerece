import { Router } from "express";
import { authenticate, requireRole } from "../../middlewares/authenticate";
import * as c from "./manufacturer.controller";

const router = Router();
router.get("/", c.list);
router.get("/:id", c.get);

router.use(authenticate, requireRole("ADMIN", "SUPER_ADMIN")); // everything below is admin-only
router.post("/", c.create);
router.patch("/:id", c.update);
router.delete("/:id", c.remove);

export default router;
