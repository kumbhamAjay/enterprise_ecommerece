import "dotenv/config";
import app from "./app";
import { testDatabaseConnection } from "./config/db";
import { getRedis } from "./config/redis";
import { startWorkers } from "./jobs/workers";
import { scheduleJobs, startTimerFallback } from "./jobs/schedule";

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    await testDatabaseConnection();
    getRedis(); // start connecting now; the app works (uncached) even if Redis is unreachable

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });

    // Background work (BullMQ): email sending + scheduled maintenance. By default the workers run inside this process;
    // set RUN_WORKERS=false and run `npm run worker` to scale them separately.
    if (process.env.RUN_WORKERS !== "false") {
      const workers = startWorkers();
      for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => workers.close().finally(() => process.exit(0)));
    }
    scheduleJobs()
      .then(() => console.log("Background jobs scheduled (BullMQ)"))
      .catch((e) => { console.error("BullMQ unavailable, using in-process timers:", e.message); startTimerFallback(); });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

startServer();
