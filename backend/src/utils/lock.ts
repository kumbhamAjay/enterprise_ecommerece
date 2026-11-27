import { randomUUID } from "node:crypto";
import { safe } from "../config/redis";

// Best-effort distributed lock (SET NX PX + owner-checked release). KNOWN LIMITS: if the holder pauses longer than the
// TTL (GC, network) the lock expires and a second holder enters, so this gives efficiency (avoid duplicate work), not
// safety. For correctness use a database constraint or a fencing token. Fails open (runs anyway) if Redis is down.
const RELEASE = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;

export async function withLock<T>(name: string, ttlMs: number, fn: () => Promise<T>): Promise<{ ran: boolean; value?: T }> {
  const token = randomUUID();
  const got = await safe((r) => r.set(`lock:${name}`, token, "PX", ttlMs, "NX"));
  if (got === null) return { ran: false }; // someone else holds it
  try {
    return { ran: true, value: await fn() }; // got === undefined (Redis down) also lands here: fail open
  } finally {
    if (got === "OK") await safe((r) => r.eval(RELEASE, 1, `lock:${name}`, token));
  }
}
