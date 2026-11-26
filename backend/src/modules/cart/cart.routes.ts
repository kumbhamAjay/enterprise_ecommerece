import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate";
import * as c from "./cart.controller";

const router = Router();
router.use(authenticate); // carts belong to a signed-in user; guests keep theirs in the browser

router.get("/", c.get);
router.delete("/", c.clear);
router.post("/merge", c.merge);
router.post("/items", c.addItem);
router.patch("/items/:productId", c.setQuantity);
router.delete("/items/:productId", c.removeItem);

export default router;
