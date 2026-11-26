import { Pool, type PoolClient } from "pg";

// Pool sizing: every connection is a whole Postgres backend process, and Supabase's session pooler allows 15 in total.
// Under load, requests queue for a free connection; connectionTimeoutMillis turns "queued forever" into a fast 503.
export const POOL_MAX = Number(process.env.PG_POOL_MAX ?? 10);
const STATEMENT_TIMEOUT_MS = Number(process.env.PG_STATEMENT_TIMEOUT_MS ?? 15_000);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false }, // Supabase needs SSL; the local benchmark DB doesn't
  max: POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS ?? 5_000),
});

// ---- query statistics: the N+1 detector and the slow-query log ----
// Counting happens on each CLIENT (pool.query is built on client.query, so counting both would double count).
export const dbStats = { queries: 0, slow: 0, totalMs: 0 };
const SLOW_MS = Number(process.env.SLOW_QUERY_MS ?? 250);

function instrument(client: PoolClient) {
  const original = client.query.bind(client) as (...a: any[]) => any;
  (client as any).query = (...args: any[]) => {
    const started = performance.now();
    const sql = String(typeof args[0] === "string" ? args[0] : args[0]?.text ?? "");
    const done = () => {
      const ms = performance.now() - started;
      dbStats.queries++;
      dbStats.totalMs += ms;
      if (ms >= SLOW_MS) {
        dbStats.slow++;
        console.warn(`[slow query ${ms.toFixed(0)} ms] ${sql.replace(/\s+/g, " ").slice(0, 160)}`); // SQL text only, never the parameters
      }
    };
    const last = args.length - 1;
    if (typeof args[last] === "function") { // pool.query() calls client.query(text, values, callback)
      const cb = args[last];
      args[last] = (...r: any[]) => { done(); cb(...r); };
      return original(...args);
    }
    const result = original(...args);
    return result && typeof result.then === "function" ? result.then((r: unknown) => (done(), r), (e: unknown) => (done(), Promise.reject(e))) : result;
  };
}

pool.on("connect", (client) => {
  instrument(client);
  // Per-connection safety net: a runaway query is cancelled instead of holding a connection (and a request) forever.
  client.query(`SET statement_timeout = ${STATEMENT_TIMEOUT_MS}`).catch(() => {});
  console.log("PostgreSQL connected successfully");
});

pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL error:", error);
});

export const poolStats = () => ({ max: POOL_MAX, total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount });

export async function testDatabaseConnection() {
  const result = await pool.query("SELECT NOW()");

  console.log("Database time:", result.rows[0].now);
}

// Postgres aborts one side of a deadlock (40P01) or a serialization conflict (40001).
// Both are safe to retry: the whole transaction was rolled back, so nothing was half-applied.
const RETRYABLE = new Set(["40001", "40P01"]);

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>, opts: { retries?: number } = {}): Promise<T> {
  const retries = opts.retries ?? 0;
  for (let attempt = 0; ; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 15 * 2 ** attempt + Math.random() * 25)); // exponential backoff + jitter
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      if (attempt < retries && RETRYABLE.has((err as { code?: string }).code ?? "")) continue;
      throw err;
    } finally {
      client.release();
    }
  }
}
