# Module 9: Search and performance

Scenario: *"Search is slow now that we have one million products."* Everything below was measured on a local
Postgres with **1,000,000 products** (`perf/seed.sql`), not guessed. Reproduce with `perf/explain.ts` and `perf/k6/`.

## 1. Diagnosis (EXPLAIN ANALYZE)

The default shop page (12 products, newest first) took **2.8 s**. The plan showed ~4.9 million buffer reads for a 12-row page.
Cause: `COUNT(*) OVER()` (to print "N pieces" and page numbers) forces Postgres to find and count *every* matching row before
returning the first 12, so the index that could answer "newest 12" instantly was useless.

| Query (12-row page) | Before | After | Why |
|---|---:|---:|---|
| newest, page 1 | 2,769 ms | 2.5 ms | no full count; index read stops after 13 rows |
| newest, page 5000 (deep) | 1,631 ms | 0.12 ms | keyset seek instead of OFFSET 59,988 |
| price low to high | 2,800 ms | 1.2 ms | `(price, id)` partial index |
| name A to Z | 2,032 ms | 1.1 ms | `(name, id)` partial index |
| leaf category | 2,246 ms | 8.8 ms | `(category_id, product_id)` index-only lookups |
| root category + descendants | 2,495 ms | 20.9 ms | same, `= ANY(ids)` |
| brand filter | 827 ms | 0.5 ms | `(manufacturer_id, created_at DESC, id DESC)` |
| price range | 964 ms | 1.6 ms | `(price, id)` |
| in stock only | 2,667 ms | 4.2 ms | bounded count + newest index |
| search "premium" (400k matches) | 1,043 ms | 4.3 ms | rank skipped past 10,000 matches |
| search "walnut" (33k matches) | 109 ms | 10 ms | same |
| combo (category + "oak" + price, price asc) | 200 ms | 26 ms | |

Raw numbers: `perf/results/*.json` (`baseline` is the old code, `after` the final one).

## 2. What changed and why

- **Bounded count.** `SELECT count(*) FROM (SELECT 1 ... LIMIT 10001)`. Exact up to 10,000, then the UI says "10,000+".
  Trade-off: no exact total for huge result sets. Nobody pages to the end of a million-row list.
- **Keyset (cursor) pagination.** `WHERE (created_at, id) < ($last_created, $last_id) ORDER BY created_at DESC, id DESC LIMIT 13`.
  Cost is the same on page 1 and page 5000 (OFFSET must read and throw away every skipped row), and pages don't shift
  or repeat rows when products are added meanwhile (covered by a test). Trade-off: no "jump to page 400"; page numbers still work up to 10,000 rows deep, beyond that the API answers 400 and asks for the cursor.
  The cursor is opaque base64url and carries a hash of the filters, so it can't be replayed against a different search; a tampered value is a 400, never a 500.
- **Indexes** (`db/schema.sql`): one per sort, each ending in `id` (the tie-breaker), **partial** (`WHERE is_active`) so they
  only contain what the shop shows; composite `(manufacturer_id, created_at DESC, id DESC)` serves "this brand, newest" with no sort step;
  `(category_id, product_id)` lets the category filter be answered from the index alone. Existing GIN full-text index kept for search.
  Each index costs write speed and disk, so superseded ones were dropped.
- **Relevance ranking only on small match sets.** `ts_rank` needs every match's text. Above 10,000 matches we order by newest and the response says so (`meta.sortedBy`).
- **Category descendants** resolved in a separate recursive CTE (cached 10 min), then `= ANY(ids)`.
- **Redis cache** (60 s, versioned keys, fail-open) for list responses. Stock badges there can lag up to the TTL; carts and checkout always read the database.

## 3. N+1

An N+1 is one query for the list plus one more per row. The list joins images/brand/stock, so it costs a constant **2 queries**
(count + page) for 2 products or 50; detail is 1; the cart is 1 (asserted in `search.test.ts` by counting queries, so a regression fails the build).

## 4. Connection pool and protection against overload

Each Postgres connection is a whole server process; Supabase's pooler allows 15. The pool is `PG_POOL_MAX` (default 10) with a
5 s connect timeout: when all connections are busy requests queue, and past the timeout they get **503 + Retry-After** instead of hanging.
Every connection has `statement_timeout` 15 s so a runaway query can't hold a connection forever (also a 503). Queries over 250 ms are logged
(SQL text only, never parameters). `GET /api/admin/diagnostics` (admin) shows pool use, query counts, cache status, memory and event-loop lag.

## 5. Load test (k6, 30 virtual users, 30 s, mixed shopper traffic: browse, search, category, brand, sorts)

| Setup | Requests | Throughput | median | p95 |
|---|---:|---:|---:|---:|
| Old code, no cache | 82 | 1.7 req/s | 15.8 s | 22.7 s |
| New code, no cache | 21,011 | 700 req/s | 35 ms | 86 ms |
| New code, Redis cache | 313,678 | 10,452 req/s | 2.5 ms | 4.6 ms |

Caveats: the API, k6 and Postgres share one laptop; the cached run is flattering because the test reuses a small set of URLs (real traffic has a longer tail);
the old-code run used the new indexes (the old code still scanned everything, so this favors it if anything).

**Overload test** (pool forced to 1 connection, 300 ms connect timeout, 100 users, 10 s): 12% of requests were rejected with a fast 503,
the rest were served, nothing crashed, and the slowest response was 862 ms.

## 6. Interview answers

- *Why is `OFFSET 100000` slow?* The database still produces and discards 100,000 rows. Keyset skips straight to the position via an index seek.
- *Why a tie-breaker (`id`) in the sort?* Equal prices/timestamps have no defined order, so pages could repeat or skip rows.
- *Partial index?* Indexes only rows matching a predicate: smaller, faster, cheaper to maintain.
- *Composite index column order?* Equality columns first, then the sort column(s); the index can then return rows already ordered.
- *Seq scan vs index scan?* Reading the whole table vs seeking by key. Seq scans are right when most rows match; wrong for "newest 12 of 1M".
- *How do you size a pool?* Bounded by the database's connection limit shared across all app instances, not by traffic; queue and fail fast beyond it.
- *Cache downside?* Staleness and invalidation. We use short TTLs, versioned keys invalidated after commit, and never cache anything correctness depends on.
