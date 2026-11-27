"use client";
import { useState } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Skeleton } from "@/components/ui/Misc";
import { useAnalytics } from "@/lib/hooks";
import { money } from "@/lib/format";
import type { Kpi, RevenuePoint } from "@/lib/types";

const RANGES = [[7, "7 days"], [30, "30 days"], [90, "90 days"], [365, "1 year"]] as const;

function Delta({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-xs text-mute">no earlier data</span>;
  const up = pct >= 0;
  return <span className={`inline-flex items-center gap-1 text-xs ${up ? "text-ok" : "text-danger"}`}>{up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{Math.abs(pct)}% vs previous period</span>;
}

function Card({ label, kpi, fmt }: { label: string; kpi?: Kpi; fmt: (n: number) => string }) {
  return (
    <div className="rounded-[3px] border border-line bg-paper px-5 py-4">
      {kpi ? <p className="font-serif text-3xl tabular-nums">{fmt(kpi.value)}</p> : <Skeleton className="h-9 w-28" />}
      <p className="eyebrow mt-1">{label}</p>
      <div className="mt-2 h-4">{kpi && <Delta pct={kpi.changePct} />}</div>
    </div>
  );
}

// Plain SVG bars: no chart library for one chart. Each bar has a <title> tooltip and the whole chart a text summary.
function Bars({ data }: { data: RevenuePoint[] }) {
  const max = Math.max(1, ...data.map((d) => d.revenue));
  const w = 100 / Math.max(1, data.length);
  const total = data.reduce((s, d) => s + d.revenue, 0);
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-56 w-full" role="img" aria-label={`Revenue by ${data.length > 0 ? "period" : "day"}, total ${money(total)}`}>
      {data.map((d, i) => (
        <rect key={d.bucket} x={i * w + w * 0.12} width={w * 0.76} y={40 - (d.revenue / max) * 38} height={Math.max(0.3, (d.revenue / max) * 38)} className={d.revenue ? "fill-ink" : "fill-line"}>
          <title>{`${d.bucket}: ${money(d.revenue)} · ${d.orders} ${d.orders === 1 ? "order" : "orders"}`}</title>
        </rect>
      ))}
    </svg>
  );
}

export function AnalyticsAdmin() {
  const [days, setDays] = useState<number>(30);
  const { summary, revenue, products, customers } = useAnalytics(days);
  const s = summary.data;
  const series = revenue.data?.series ?? [];

  return (
    <section>
      <div role="tablist" aria-label="Period" className="flex gap-1">
        {RANGES.map(([d, l]) => (
          <button key={d} role="tab" aria-selected={days === d} onClick={() => setDays(d)} className={`rounded-full border px-4 py-1.5 text-xs transition-colors ${days === d ? "border-ink bg-ink text-ivory" : "border-line text-ink-soft hover:border-ink"}`}>{l}</button>
        ))}
      </div>

      {summary.isError && <p className="mt-6 text-sm text-danger">Couldn’t load the report.</p>}
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card label="Revenue" kpi={s?.revenue} fmt={money} />
        <Card label="Orders" kpi={s?.orders} fmt={String} />
        <Card label="Average order" kpi={s?.avgOrderValue} fmt={money} />
        <div className="rounded-[3px] border border-line bg-paper px-5 py-4">
          {s ? <p className="font-serif text-3xl tabular-nums">{s.newCustomers}</p> : <Skeleton className="h-9 w-16" />}
          <p className="eyebrow mt-1">New customers</p>
          <p className="mt-2 h-4 text-xs text-mute">{s && `${s.buyers} bought · ${s.refunded.orders} refunded (${money(s.refunded.total)})`}</p>
        </div>
      </div>

      <div className="mt-8 rounded-[3px] border border-line bg-paper p-5">
        <div className="flex items-baseline justify-between">
          <p className="eyebrow">Revenue {days > 90 ? "by week" : "by day"}</p>
          {series.length > 0 && <p className="text-xs text-mute">Updated every 5 minutes</p>}
        </div>
        <div className="mt-4">{revenue.isPending ? <Skeleton className="h-56 w-full" /> : <Bars data={series} />}</div>
        {series.length > 0 && <div className="mt-1 flex justify-between text-xs text-mute"><span>{series[0].bucket}</span><span>{series.at(-1)!.bucket}</span></div>}
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <div>
          <p className="eyebrow mb-3">Best sellers</p>
          <div className="overflow-x-auto rounded-[3px] border border-line bg-paper">
            <table className="w-full text-left text-sm">
              <thead><tr className="border-b border-line">{["#", "Product", "Units", "Revenue", "Share"].map((h, i) => <th key={h} className={`eyebrow px-4 py-3 font-medium ${i > 1 ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
              <tbody>
                {products.isPending ? <tr><td colSpan={5} className="p-4"><Skeleton className="h-24" /></td></tr>
                  : products.data?.length === 0 ? <tr><td colSpan={5} className="px-4 py-8 text-center text-mute">No sales in this period.</td></tr>
                  : products.data?.map((p) => (
                    <tr key={p.sku} className="border-b border-line last:border-0">
                      <td className="px-4 py-3 text-mute">{p.rank}</td>
                      <td className="px-4 py-3">{p.name}<span className="block font-mono text-xs text-mute">{p.sku}</span></td>
                      <td className="px-4 py-3 text-right tabular-nums">{p.units}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{money(p.revenue)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-mute">{p.sharePct}%</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <p className="eyebrow mb-3">Top customers</p>
          <div className="overflow-x-auto rounded-[3px] border border-line bg-paper">
            <table className="w-full text-left text-sm">
              <thead><tr className="border-b border-line">{["Customer", "Orders", "Spend", "Average"].map((h, i) => <th key={h} className={`eyebrow px-4 py-3 font-medium ${i > 0 ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
              <tbody>
                {customers.isPending ? <tr><td colSpan={4} className="p-4"><Skeleton className="h-24" /></td></tr>
                  : customers.data?.length === 0 ? <tr><td colSpan={4} className="px-4 py-8 text-center text-mute">No customers bought in this period.</td></tr>
                  : customers.data?.map((c) => (
                    <tr key={c.userId} className="border-b border-line last:border-0">
                      <td className="px-4 py-3">{c.email}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{c.orders}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{money(c.spend)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-mute">{money(c.avgOrder)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {s && s.ordersByStatus.length > 0 && (
        <div className="mt-8">
          <p className="eyebrow mb-3">Orders placed in this period, by outcome</p>
          <div className="flex flex-wrap gap-3">
            {s.ordersByStatus.map((o) => <div key={o.status} className="rounded-[3px] border border-line bg-paper px-4 py-3"><p className="font-serif text-xl tabular-nums">{o.orders}</p><p className="eyebrow mt-0.5">{o.status.replace("_", " ").toLowerCase()}</p></div>)}
          </div>
        </div>
      )}
    </section>
  );
}
