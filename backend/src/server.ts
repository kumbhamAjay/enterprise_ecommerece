import "dotenv/config";
import app from "./app";
import { pool, testDatabaseConnection } from "./config/db";
import { logger } from "./config/logger";
import { getRedis } from "./config/redis";
import { startWorkers } from "./jobs/workers";
import { scheduleJobs, startTimerFallback } from "./jobs/schedule";

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    await testDatabaseConnection();
    getRedis(); // start connecting now; the app works (uncached) even if Redis is unreachable

    const server = app.listen(PORT, () => logger.info(`Server running on port ${PORT}`));

    // Background work (BullMQ): email sending + scheduled maintenance. By default the workers run inside this process;
    // set RUN_WORKERS=false and run `npm run worker` to scale them separately.
    const workers = process.env.RUN_WORKERS !== "false" ? startWorkers() : undefined;
    scheduleJobs()
      .then(() => logger.info("Background jobs scheduled (BullMQ)"))
      .catch((e) => { logger.error(`BullMQ unavailable, using in-process timers: ${e.message}`); startTimerFallback(); });

    // Graceful shutdown (docker stop / a deploy sends SIGTERM): stop accepting connections, let in-flight requests finish,
    // then close the workers, Redis and the pool. Without this a deploy cuts requests (and a half-processed job) off mid-way.
    let stopping = false;
    const shutdown = async (sig: string) => {
      if (stopping) return;
      stopping = true;
      logger.info(`${sig} received: shutting down`);
      setTimeout(() => { logger.error("shutdown timed out, forcing exit"); process.exit(1); }, 10_000).unref();
      await new Promise<void>((done) => { server.close(() => done()); server.closeIdleConnections(); });
      await workers?.close().catch(() => {});
      await getRedis().quit().catch(() => {});
      await pool.end().catch(() => {});
      process.exit(0);
    };
    for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => void shutdown(sig));
  } catch (error) {
    logger.fatal({ err: error }, "Failed to start server");
    process.exit(1);
  }
}

startServer();
