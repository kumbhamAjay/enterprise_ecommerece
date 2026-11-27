import { Router } from "express";
import { authenticate } from "../../middlewares/authenticate";
import { byIp, byIpAndEmail, rateLimit } from "../../utils/rateLimit";
import { forgotPassword, login, logout, me, refresh, register, resendVerification, resetPassword, verifyEmail } from "./auth.controller";

const router = Router();
// Sliding-window limits (Redis). Login is keyed by IP + email so one attacker can't lock a victim out from everywhere.
router.post("/register", rateLimit({ name: "register", limit: 20, windowSec: 3600, key: byIp }), register);
router.post("/login", rateLimit({ name: "login", limit: 10, windowSec: 900, key: byIpAndEmail }), login);
router.post("/refresh", rateLimit({ name: "refresh", limit: 120, windowSec: 60, key: byIp }), refresh);
router.post("/logout", logout);
router.get("/me", authenticate, me);
router.post("/forgot-password", rateLimit({ name: "forgot", limit: 5, windowSec: 3600, key: byIp }), forgotPassword);
router.post("/reset-password", rateLimit({ name: "reset", limit: 10, windowSec: 3600, key: byIp }), resetPassword);
router.post("/verify-email", verifyEmail);
router.post("/resend-verification", authenticate, resendVerification);

export default router;
