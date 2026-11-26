import { Router } from "express";
import { authenticate, requireRole } from "../../middlewares/authenticate";
import * as c from "./product.controller";

const router = Router();
router.get("/", c.list);
router.get("/:id", c.get);

router.use(authenticate, requireRole("ADMIN", "SUPER_ADMIN")); // writes are admin-only
router.post("/import", c.importProducts);
router.post("/", c.create);
router.patch("/:id", c.update);
router.delete("/:id", c.deactivate);
router.post("/:id/images", c.addImage);
router.delete("/:id/images/:imageId", c.deleteImage);

export default router;
