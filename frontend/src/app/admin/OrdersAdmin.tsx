"use client";
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Pagination } from "@/components/product/Pagination";
import { StatusBadge, STATUS_LABEL } from "@/components/orders/StatusBadge";
import { EmptyState, Skeleton } from "@/components/ui/Misc";
import { money } from "@/lib/format";
import { useAdminOrders } from "@/lib/hooks";
import type { OrderStatus } from "@/lib/types";
import { OrderPanel } from "./OrderPanel";

const STATUSES = Object.keys(STATUS_LABEL) as OrderStatus[];

export function OrdersAdmin() {
  const [page, setPage] = useState(1);
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const { data, isPending, isError } = useAdminOrders({ q: q || undefined, status: status || undefined, page, limit: 10 });

  useEffect(() => {
    const t = setTimeout(() => { setQ(text.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [text]);

  return (
    <section>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative block w-full sm:w-96">
          <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-mute" />
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Order number or customer email" aria-label="Search orders" className="h-11 w-full rounded-[3px] border border-line bg-paper pl-10 pr-3 text-sm focus:border-ink focus:outline-none" />
        </label>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Filter by status" className="h-11 rounded-[3px] border border-line bg-paper px-4 text-sm focus:border-ink focus:outline-none">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
      </div>

      <div className="mt-8 overflow-x-auto rounded-[3px] border border-line bg-paper">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead>
            <tr className="border-b border-line">
              {["Order", "Customer", "Placed", "Items", "Total", "Status"].map((h, i) => <th key={h} className={`eyebrow px-5 py-4 font-medium ${i === 3 || i === 4 ? "text-right" : ""}`}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {isPending ? (
              Array.from({ length: 6 }, (_, i) => <tr key={i} className="border-b border-line last:border-0"><td colSpan={6} className="px-5 py-4"><Skeleton className="h-9" /></td></tr>)
            ) : isError ? (
              <tr><td colSpan={6} className="px-5 py-10 text-center text-danger">Couldn’t load orders.</td></tr>
            ) : data.data.length === 0 ? (
              <tr><td colSpan={6}><EmptyState title="No orders" text={q || status ? "Nothing matches these filters." : "Orders appear here as soon as customers check out."} /></td></tr>
            ) : (
              data.data.map((o) => (
                <tr key={o.id} onClick={() => setOpenId(o.id)} onKeyDown={(e) => e.key === "Enter" && setOpenId(o.id)} tabIndex={0} className="cursor-pointer border-b border-line transition-colors last:border-0 hover:bg-sand/50">
                  <td className="px-5 py-3.5 font-mono text-xs">{o.orderNumber}</td>
                  <td className="px-5 py-3.5 text-ink-soft">{o.customerEmail}</td>
                  <td className="px-5 py-3.5 text-mute">{new Date(o.placedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</td>
                  <td className="px-5 py-3.5 text-right tabular-nums">{o.itemCount}</td>
                  <td className="px-5 py-3.5 text-right tabular-nums">{money(o.total)}</td>
                  <td className="px-5 py-3.5"><StatusBadge status={o.status} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {data && <Pagination page={data.meta.page} totalPages={data.meta.totalPages} onChange={setPage} />}
      <OrderPanel orderId={openId} onClose={() => setOpenId(null)} />
    </section>
  );
}
