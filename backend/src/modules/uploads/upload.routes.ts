import { Router } from "express";
import { z } from "zod";
import { authenticate, requireRole } from "../../middlewares/authenticate";
import { destroyAsset, PUBLIC_ID_PATTERN, signUpload } from "../../config/cloudinary";

// /api/admin/uploads
export const adminUploadRoutes = Router();
adminUploadRoutes.use(authenticate, requireRole("ADMIN", "SUPER_ADMIN"));

// Step 1 of an upload: a short-lived signature. The API secret stays on the server.
adminUploadRoutes.post("/sign", (_req, res) => res.json({ success: true, data: signUpload() }));

// Admin removed an uploaded image before saving the product: don't leave the file orphaned in storage.
adminUploadRoutes.post("/discard", async (req, res) => {
  const { publicId } = z.object({ publicId: z.string().regex(PUBLIC_ID_PATTERN) }).parse(req.body);
  await destroyAsset(publicId);
  res.status(204).end();
});
