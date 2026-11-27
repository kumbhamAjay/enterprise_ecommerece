import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import type { RequestHandler, Response } from "express";
import { safe, stats } from "../config/redis";

// ---------------------------------------------------------------------------------------------
// Cache-aside with: TTL jitter, versioned keys (O(1) invalidation, race-safe), stampede protection (in-process
// single-flight + a Redis lock across instances), and graceful fallback when Redis is unavailable.
// ---------------------------------------------------------------------------------------------
type Status = "HIT" | "MISS" | "BYPASS" | "COALESCED";
const als = new AsyncLocalStorage<{ status?: Status }>();
export const cacheContext: RequestHandler = (_req, _res, next) => als.run({}, next);
export const cacheStatus = () => als.getStore()?.status;
const mark = (s: Status) => { const st = als.getStore(); if (st) st.status = s; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- versioning: every cached catalog key embeds the current version. A write bumps it, orphaning ALL old keys at once
//      (no SCAN, no DEL patterns). A reader reads the version BEFORE loading from the database, so a slow reader that
//      raced with a write stores its (possibly stale) result under the OLD version, which nobody reads any more.
export const catalogVersion = async () => (await safe((r) => r.get("catalog:ver"))) ?? "0";
export const bumpCatalog = async () => { await safe((r) => r.incr("catalog:ver")); }; // call AFTER the database commit
export const catalogKey = async (suffix: string) => `catalog:v${await catalogVersion()}:${suffix}`;
export const hashOf = (v: unknown) => createHash("sha1").update(JSON.stringify(v)).digest("hex").slice(0, 16);

const RELEASE = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`; // only the owner may release
const inflight = new Map<string, Promise<unknown>>();

export async function cached<T>(key: string, ttlSec: number, loader: () => Promise<T>, opts: { singleFlight?: boolean } = {}): Promise<T> {
  const raw = await safe((r) => r.get(key));
  if (raw === undefined) { stats.bypass++; mark("BYPASS"); return loader(); } // Redis unavailable: straight to the database
  if (raw !== null) { stats.hits++; mark("HIT"); return JSON.parse(raw) as T; }

  const fill = async (): Promise<T> => {
    // Cross-instance stampede protection: one caller rebuilds, the rest wait briefly for it instead of hitting the database.
    const lockKey = `lock:${key}`;
    const token = randomUUID();
    const got = await safe((r) => r.set(lockKey, token, "PX", 5000, "NX"));
    if (got === "OK") {
      try {
        const again = await safe((r) => r.get(key)); // someone may have filled it while we were acquiring the lock
        if (again) { stats.hits++; mark("HIT"); return JSON.parse(again) as T; }
        stats.misses++; mark("MISS");
        const value = await loader();
        // TTL jitter (+-10%): entries created together must not all expire together (that is a stampede too)
        await safe((r) => r.set(key, JSON.stringify(value), "PX", Math.round(ttlSec * 1000 * (0.9 + Math.random() * 0.2))));
        return value;
      } finally {
        await safe((r) => r.eval(RELEASE, 1, lockKey, token));
      }
    }
    for (let i = 0; i < 20; i++) { // lock held elsewhere: poll for the value, up to ~1s
      await sleep(50);
      const v = await safe((r) => r.get(key));
      if (v) { stats.lockWaits++; mark("HIT"); return JSON.parse(v) as T; }
      if (v === undefined) break;
    }
    stats.misses++; mark("MISS");
    return loader(); // better slow than failing: build it ourselves
  };

  if (opts.singleFlight === false) return fill();
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) { stats.coalesced++; mark("COALESCED"); return existing; } // same process, same key: share one rebuild
  const run = fill().finally(() => inflight.delete(key));
  inflight.set(key, run);
  return run;
}

// Wrap a write: run it, and only AFTER it succeeded (database committed) invalidate the catalog cache.
// Invalidating before the commit would let a concurrent reader re-cache the old data.
export const afterWrite = <A extends unknown[], R>(fn: (...a: A) => Promise<R>) => async (...a: A): Promise<R> => {
  const result = await fn(...a);
  await bumpCatalog();
  return result;
};

// Debug/observability header: was this response served from Redis?
export const tagCache = (res: Response) => { const s = cacheStatus(); if (s) res.setHeader("X-Cache", s); };
