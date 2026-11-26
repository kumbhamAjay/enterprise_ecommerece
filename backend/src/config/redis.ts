import Redis from "ioredis";

// Redis is an OPTIMISATION, never a dependency: every caller goes through safe(), which turns any Redis failure into
// "no answer" so the app falls back to the database (cache) or lets the request through (rate limit, revocation).
let client: Redis | undefined;
let downUntil = 0; // simple circuit breaker: after a failure, don't even try for a few seconds (no latency tax per request)
export const stats = { hits: 0, misses: 0, bypass: 0, coalesced: 0, lockWaits: 0, errors: 0 };

export function getRedis(): Redis {
  if (!client) {
    client = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
      lazyConnect: true,
      keyPrefix: process.env.REDIS_KEY_PREFIX ?? "shopeasy:",
      enableOfflineQueue: false, // when Redis is down fail immediately instead of queueing commands in memory
      maxRetriesPerRequest: 1,
      connectTimeout: 1000,
      commandTimeout: 300,
      retryStrategy: (n) => Math.min(n * 200, 5000), // keep reconnecting in the background
    });
    client.on("error", () => {}); // errors surface through safe(); an unhandled 'error' event would crash the process
    // In tests the socket must not keep the process alive (test files never close it). A real server is kept alive by its HTTP listener.
    if (process.env.NODE_ENV === "test") client.on("connect", () => (client as unknown as { stream?: { unref?: () => void } }).stream?.unref?.());
    void client.connect().catch(() => {});
  }
  return client;
}
export function setRedisClient(c: unknown) { // tests inject a broken client
  const old = client as unknown as { disconnect?: () => void } | undefined;
  if (old && old !== c && typeof old.disconnect === "function") old.disconnect(); // never leak the connection we're replacing
  client = c as Redis | undefined;
  downUntil = 0;
}

export async function safe<T>(fn: (r: Redis) => Promise<T>): Promise<T | undefined> {
  if (Date.now() < downUntil) return undefined;
  try {
    return await fn(getRedis());
  } catch {
    stats.errors++;
    downUntil = Date.now() + 5000;
    return undefined;
  }
}
export const redisStatus = () => (Date.now() < downUntil ? "down" : getRedis().status);
export const resetBreaker = () => { downUntil = 0; };
