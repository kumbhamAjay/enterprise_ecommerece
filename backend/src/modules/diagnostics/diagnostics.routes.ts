import { monitorEventLoopDelay } from "node:perf_hooks";
import { Router } from "express";
import { authenticate, requireRole } from "../../middlewares/authenticate";
import { dbStats, poolStats } from "../../config/db";
import { redisStatus, stats as cacheStats } from "../../config/redis";

// Event-loop delay: how long the single JS thread was blocked. High p99 = something is hogging the CPU.
const loop = monitorEventLoopDelay({ resolution: 20 });
loop.enable();

// /api/admin/diagnostics
export const adminDiagnosticsRoutes = Router();
adminDiagnosticsRoutes.use(authenticate, requireRole("ADMIN", "SUPER_ADMIN"));

adminDiagnosticsRoutes.get("/", (_req, res) => {
  const mem = process.memoryUsage();
  res.json({
    success: true,
    data: {
      db: { pool: poolStats(), queries: dbStats.queries, slowQueries: dbStats.slow, avgQueryMs: dbStats.queries ? Number((dbStats.totalMs / dbStats.queries).toFixed(2)) : 0 },
      cache: { redis: redisStatus(), ...cacheStats },
      process: { uptimeSec: Math.round(process.uptime()), rssMb: Math.round(mem.rss / 1048576), heapUsedMb: Math.round(mem.heapUsed / 1048576), eventLoopDelayMs: { mean: Number((loop.mean / 1e6).toFixed(2)), p99: Number((loop.percentile(99) / 1e6).toFixed(2)), max: Number((loop.max / 1e6).toFixed(2)) } },
    },
  });
});
