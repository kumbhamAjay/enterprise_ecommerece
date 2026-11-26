import IORedis from "ioredis";
import { Queue } from "bullmq";

// BullMQ needs its own Redis connections (no key prefix: BullMQ namespaces itself with `prefix`).
// Tests set QUEUE_PREFIX so they never touch the real queues.
export const queuePrefix = () => process.env.QUEUE_PREFIX ?? "shopeasy:bull";
const url = () => process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

// Producers (the API) must fail FAST when Redis is down: an email enqueue may never hang a user's request.
let producer: IORedis | undefined;
export function producerConnection() {
  if (!producer) {
    producer = new IORedis(url(), { enableOfflineQueue: false, maxRetriesPerRequest: 1, connectTimeout: 1000, retryStrategy: (n) => Math.min(n * 200, 5000) });
    producer.on("error", () => {});
    if (process.env.NODE_ENV === "test") producer.on("connect", () => (producer as unknown as { stream?: { unref?: () => void } }).stream?.unref?.());
  }
  return producer;
}
// Workers block on Redis, which requires maxRetriesPerRequest: null (a BullMQ rule).
export const workerConnection = () => {
  const c = new IORedis(url(), { maxRetriesPerRequest: null, retryStrategy: (n) => Math.min(n * 200, 5000) });
  c.on("error", () => {});
  return c;
};

// Wait (briefly) for the producer connection: right after boot it is still connecting, and with the offline queue off a command
// would fail instantly. Throws if Redis stays unreachable, which callers treat as "queue unavailable".
export async function queueReady(ms = 2000): Promise<void> {
  const c = producerConnection();
  if (c.status === "ready") return;
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => { c.off("ready", ok); reject(new Error("queue unavailable (Redis not reachable)")); }, ms);
    const ok = () => { clearTimeout(t); resolve(); };
    c.once("ready", ok);
  });
}

export const EMAIL_QUEUE = "email";
export const MAINTENANCE_QUEUE = "maintenance";

const queues = new Map<string, Queue>();
export function getQueue(name: string): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, {
      connection: producerConnection(),
      prefix: queuePrefix(),
      skipWaitingForReady: true,
      defaultJobOptions: { removeOnComplete: { age: 3600, count: 1000 }, removeOnFail: { age: 7 * 24 * 3600, count: 5000 } },
    });
    q.on("error", () => {});
    queues.set(name, q);
  }
  return q;
}
export async function closeQueues() {
  await Promise.all([...queues.values()].map((q) => q.close().catch(() => {})));
  queues.clear();
  producer?.disconnect();
  producer = undefined;
}

// A queue operation that can't complete in 1.5 s is treated as "queue unavailable" (the outbox row makes that safe).
export const withTimeout = <T>(p: Promise<T>, ms = 1500) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("queue timeout")), ms))]);
