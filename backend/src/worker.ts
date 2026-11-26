// Standalone worker process: `npm run worker` (use with RUN_WORKERS=false on the API server).
import "dotenv/config";
import { getRedis } from "./config/redis";
import { startWorkers } from "./jobs/workers";
import { scheduleJobs, startTimerFallback } from "./jobs/schedule";

getRedis();
const workers = startWorkers();
scheduleJobs().then(() => console.log("worker: BullMQ workers running")).catch((e) => { console.error("worker: BullMQ unavailable, using timers:", e.message); startTimerFallback(); });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => workers.close().finally(() => process.exit(0)));
