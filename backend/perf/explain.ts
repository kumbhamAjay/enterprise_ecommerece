// Runs EXPLAIN (ANALYZE, BUFFERS) on the REAL list queries for a set of scenarios, against the benchmark database.
//   BENCH_URL=postgres://postgres:bench@127.0.0.1:5433/bench npx tsx perf/explain.ts <label>
// For each scenario it times what production runs for a first page: the bounded COUNT query plus the page query.
import { Pool } from "pg";
import { mkdirSync, writeFileSync } from "node:fs";
import { buildCountQuery, buildFilters, buildRowsQuery, descendantCategoryIds, KEYSET, type KeysetSort } from "../src/modules/products/product.repository";
import type { ListQuery } from "../src/modules/products/product.types";

const pool = new Pool({ connectionString: process.env.BENCH_URL ?? "postgres://postgres:bench@127.0.0.1:5433/bench", max: 1 });
const base = { page: 1, limit: 12 } as ListQuery;
const S = (name: string, q: Partial<ListQuery>) => ({ name, q: { ...base, ...q } as ListQuery });

// ids in the benchmark data: 1-12 root categories, 13-312 groups and types; brands 1-300
export const SCENARIOS = [
  S("01 newest, page 1", {}),
  S("02 newest, DEEP (row 59,989 onward)", { page: 5000 }),
  S("03 price low->high, page 1", { sort: "price_asc" }),
  S("04 name A-Z, page 1", { sort: "name" }),
  S("05 search rare: '400000' (1 match)", { q: "400000" }),
  S("05c relevance on a small set: 'oak' in a leaf category", { q: "oak", categoryId: "300" }),
  S("05b search medium: 'walnut stool'", { q: "walnut stool" }),
  S("06 search common: 'walnut'", { q: "walnut" }),
  S("07 search very common: 'premium'", { q: "premium" }),
  S("08 leaf category, newest", { categoryId: "300" }),
  S("09 root category (+descendants), newest", { categoryId: "1" }),
  S("10 brand filter, newest", { manufacturerId: "7" }),
  S("11 price 100-120, newest", { minPrice: 100, maxPrice: 120 }),
  S("12 in stock only, newest", { inStock: "true" }),
  S("13 combo: root category + 'oak' + price<=200, price asc", { categoryId: "2", q: "oak", maxPrice: 200, sort: "price_asc" }),
];

type Node = { "Node Type": string; "Relation Name"?: string; "Index Name"?: string; "Sort Method"?: string; "Rows Removed by Filter"?: number; Plans?: Node[] };
const walk = (n: Node, f: (n: Node) => void) => { f(n); n.Plans?.forEach((c) => walk(c, f)); };

export async function explainOne(text: string, params: unknown[]) {
  let last: any;
  for (let i = 0; i < 2; i++) { // twice: the second run is warm (cached), which is what a busy server sees
    last = (await pool.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${text}`, params)).rows[0]["QUERY PLAN"][0];
  }
  const indexes = new Set<string>(); const seq = new Set<string>(); let removed = 0; let sort = "";
  walk(last.Plan, (n) => {
    if (n["Index Name"]) indexes.add(n["Index Name"]);
    if (n["Node Type"] === "Seq Scan" && n["Relation Name"]) seq.add(n["Relation Name"]);
    if (n["Rows Removed by Filter"]) removed += n["Rows Removed by Filter"];
    if (n["Sort Method"]) sort = n["Sort Method"];
  });
  const b = last.Plan;
  return { ms: Number(last["Execution Time"].toFixed(2)), buffers: b["Shared Hit Blocks"] + b["Shared Read Blocks"], removed, sort, indexes: [...indexes], seqScans: [...seq] };
}

// The value of the last row of an OFFSET page: what a client's cursor would hold when it is already deep in the list
async function cursorAt(q: ListQuery, sort: KeysetSort, offset: number, ids?: string[]): Promise<[string, string]> {
  const f = buildFilters(q, ids);
  const { text, params } = buildRowsQuery(f, { sort, offset: offset - 1, limit: 1 });
  const r = (await pool.query(text, params)).rows[0];
  const col = KEYSET[sort].col.slice(2);
  return [String(col === "created_at" ? r._created : r[col]), r.id];
}

if (require.main === module) {
  (async () => {
    const label = process.argv[2] ?? "run";
    const out: Record<string, unknown> = {};
    console.log(`\n== ${label} (cost of a FIRST page = bounded count + page query) ==`);
    for (const sc of SCENARIOS) {
      const ids = sc.q.categoryId ? await descendantCategoryIds(pool, sc.q.categoryId) : undefined;
      const f = buildFilters(sc.q, ids);
      const cnt = buildCountQuery(f, 10_001);
      const n = (await pool.query(cnt.text, cnt.params)).rows[0].n as number;
      const requested = sc.q.sort ?? (sc.q.q ? "relevance" : "newest");
      const sort = requested === "relevance" && (!sc.q.q || n > 10_000) ? "newest" : requested;

      const deep = sc.name.includes("DEEP");
      const after = deep ? await cursorAt(sc.q, "newest", 59_989, ids) : undefined;
      const counted = deep ? { ms: 0 } : await explainOne(cnt.text, cnt.params);
      const rows = buildRowsQuery(f, { sort: sort as any, after, offset: after ? 0 : (sc.q.page - 1) * sc.q.limit, limit: sc.q.limit });
      const page = await explainOne(rows.text, rows.params);
      const total = Number((counted.ms + page.ms).toFixed(2));
      out[sc.name] = { totalMs: total, countMs: counted.ms, pageMs: page.ms, buffers: page.buffers, removed: page.removed, sort: page.sort, indexes: page.indexes, seqScans: page.seqScans, sortedBy: sort, matches: n };
      console.log(`${sc.name.padEnd(56)} ${String(total).padStart(8)} ms (count ${String(counted.ms).padStart(6)} + page ${String(page.ms).padStart(7)}) | matches ${String(n > 10000 ? "10,000+" : n).padStart(7)} | buffers ${String(page.buffers).padStart(7)} | ${page.seqScans.length ? "SEQ SCAN " + page.seqScans.join(",") + " " : ""}${page.sort ? "sort:" + page.sort + " " : ""}${page.indexes.filter((i) => !/_pkey$/.test(i)).slice(0, 2).join(",")}${sort !== requested ? " [rank->newest]" : ""}`);
    }
    mkdirSync("perf/results", { recursive: true });
    writeFileSync(`perf/results/${label}.json`, JSON.stringify(out, null, 2));
    await pool.end();
  })();
}
