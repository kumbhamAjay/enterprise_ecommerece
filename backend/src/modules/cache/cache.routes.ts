import { Router } from "express";
import { authenticate, requireRole } from "../../middlewares/authenticate";
import { redisStatus, stats } from "../../config/redis";
import { bumpCatalog, catalogVersion } from "../../utils/cache";

// /api/admin/cache
export const adminCacheRoutes = Router();
adminCacheRoutes.use(authenticate, requireRole("ADMIN", "SUPER_ADMIN"));

adminCacheRoutes.get("/", async (_req, res) => {
  const lookups = stats.hits + stats.misses + stats.coalesced;
  res.json({
    success: true,
    data: { redis: redisStatus(), catalogVersion: await catalogVersion(), ...stats, hitRate: lookups ? Number(((stats.hits + stats.coalesced) / lookups).toFixed(3)) : null },
  });
});

// Emergency lever: orphan every cached catalog entry at once (O(1): just bumps the version).
adminCacheRoutes.post("/flush", async (_req, res) => {
  await bumpCatalog();
  res.json({ success: true, data: { catalogVersion: await catalogVersion() } });
});
