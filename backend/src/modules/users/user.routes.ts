import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate";
import * as c from "./user.controller";

const router = Router();
router.use(authenticate); // every /users route needs a valid access token

router.patch("/me", c.updateProfile);
router.post("/me/password", c.changePassword);
router.get("/me/addresses", c.listAddresses);
router.post("/me/addresses", c.createAddress);
router.patch("/me/addresses/:id", c.updateAddress);
router.delete("/me/addresses/:id", c.deleteAddress);

export default router;
