import { randomUUID } from "node:crypto";
import type { Request, RequestHandler } from "express";
import { safe } from "../config/redis";
import { HttpError } from "./httpError";

// Sliding-window log in a sorted set, run as ONE Lua script (atomic): drop entries older than the window, count what's left,
// admit and record this request only if under the limit. Time comes from Redis (TIME), so all app instances agree.
// Trade-off vs a fixed window (INCR + EXPIRE): no burst at window edges and exact accounting, at O(limit) memory per key.
const SCRIPT = `
local t = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)
local window, limit = tonumber(ARGV[1]), tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - window)
local count = redis.call('ZCARD', KEYS[1])
if count < limit then
  redis.call('ZADD', KEYS[1], now, ARGV[3])
  redis.call('PEXPIRE', KEYS[1], window)
  return {1, limit - count - 1, 0}
end
local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
return {0, 0, window - (now - tonumber(oldest[2]))}`;

export type Verdict = { allowed: boolean; remaining: number; retryAfterMs: number };

export async function slidingWindow(key: string, limit: number, windowMs: number): Promise<Verdict | undefined> {
  const r = await safe((c) => c.eval(SCRIPT, 1, `rl:${key}`, windowMs, limit, randomUUID()) as Promise<[number, number, number]>);
  return r ? { allowed: r[0] === 1, remaining: r[1], retryAfterMs: r[2] } : undefined; // undefined = Redis down
}

const human = (ms: number) => { const s = Math.ceil(ms / 1000); return s < 90 ? `${s} seconds` : `${Math.ceil(s / 60)} minutes`; };

export function rateLimit(o: { name: string; limit: number; windowSec: number; key: (req: Request) => string | undefined }): RequestHandler {
  return async (req, res, next) => {
    if (process.env.RATE_LIMIT_DISABLED === "1") return next(); // test suites register dozens of users from one IP
    const who = o.key(req);
    if (!who) return next();
    const v = await slidingWindow(`${o.name}:${who}`, o.limit, o.windowSec * 1000);
    if (!v) return next(); // FAIL OPEN: if Redis is down we'd rather serve users than lock everyone out
    res.setHeader("RateLimit-Limit", String(o.limit));
    res.setHeader("RateLimit-Remaining", String(v.remaining));
    if (!v.allowed) {
      res.setHeader("Retry-After", String(Math.ceil(v.retryAfterMs / 1000)));
      throw new HttpError(429, `Too many attempts. Try again in ${human(v.retryAfterMs)}.`);
    }
    next();
  };
}

// req.ip honours X-Forwarded-For only from loopback (the Next.js proxy), see app.ts
export const byIp = (req: Request) => req.ip;
export const byIpAndEmail = (req: Request) => `${req.ip}:${String(req.body?.email ?? "").trim().toLowerCase()}`;
export const byUser = (req: Request) => req.user?.sub;
