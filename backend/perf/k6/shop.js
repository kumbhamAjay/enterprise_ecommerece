// Shopper traffic against the product list. Run: see perf/k6/run.sh
import http from "k6/http";
import { check } from "k6";
import { Trend } from "k6/metrics";

const BASE = __ENV.BASE || "http://host.docker.internal:5100";
const search = ["walnut", "oak", "premium", "walnut stool", "400000"];
const sorts = ["newest", "price_asc", "price_desc", "name"];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const listMs = new Trend("list_ms", true);

export const options = {
  scenarios: { shoppers: { executor: "constant-vus", vus: Number(__ENV.VUS || 30), duration: __ENV.DURATION || "30s" } },
  thresholds: { http_req_failed: ["rate<0.5"] },
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "max"],
};

export default function () {
  const r = Math.random();
  let url;
  if (r < 0.4) url = `/api/products?limit=12&page=${1 + Math.floor(Math.random() * 3)}`;
  else if (r < 0.65) url = `/api/products?limit=12&q=${encodeURIComponent(pick(search))}`;
  else if (r < 0.8) url = `/api/products?limit=12&categoryId=${1 + Math.floor(Math.random() * 12)}`;
  else if (r < 0.9) url = `/api/products?limit=12&manufacturerId=${1 + Math.floor(Math.random() * 300)}`;
  else url = `/api/products?limit=12&sort=${pick(sorts)}`;
  const res = http.get(BASE + url, { tags: { name: "list" } });
  listMs.add(res.timings.duration);
  check(res, { "200 or 503": (x) => x.status === 200 || x.status === 503 });
}
