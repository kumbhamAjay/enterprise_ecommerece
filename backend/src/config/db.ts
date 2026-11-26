import { Pool, type PoolClient } from "pg";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

pool.on("connect", () => {
  console.log("PostgreSQL connected successfully");
});

pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL error:", error);
});

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
