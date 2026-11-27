"use client";
import { useEffect, useState } from "react";
import { AlertTriangle, Search } from "lucide-react";
import { EmptyState, Skeleton } from "@/components/ui/Misc";
import { Pagination } from "@/components/product/Pagination";
import { useInventory } from "@/lib/hooks";
import { StockBadge } from "./StockBadge";
import { StockPanel } from "./StockPanel";

export function InventoryAdmin() {
  const [page, setPage] = useState(1);
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [low, setLow] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const { data, isPending, isError } = useInventory({ q: q || undefined, lowStock: low ? "true" : undefined, page, limit: 12 });

  useEffect(() => {
    const t = setTimeout(() => { setQ(text.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [text]);

  const num = "px-5 py-3 text-right tabular-nums";
  return (
    <section>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative block w-full sm:w-80">
          <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-mute" />
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search by name or SKU" aria-label="Search inventory" className="h-11 w-full rounded-[3px] border border-line bg-paper pl-10 pr-3 text-sm focus:border-ink focus:outline-none" />
        </label>
        <button onClick={() => { setLow((l) => !l); setPage(1); }} aria-pressed={low} className={`inline-flex h-11 items-center gap-2.5 rounded-[3px] border px-5 text-sm transition-colors ${low ? "border-gold bg-gold-soft text-[#6d5126]" : "border-line bg-paper text-ink-soft hover:border-ink"}`}>
          <AlertTriangle size={15} /> Low stock only
        </button>
      </div>

      <div className="mt-8 overflow-x-auto rounded-[3px] border border-line bg-paper">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead>
            <tr className="border-b border-line">
              {["Product", "On hand", "Reserved", "Available", "Alert at", "Status"].map((h, i) => <th key={h} className={`eyebrow px-5 py-4 font-medium ${i > 0 && i < 5 ? "text-right" : ""}`}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {isPending ? (
              Array.from({ length: 6 }, (_, i) => <tr key={i} className="border-b border-line last:border-0"><td colSpan={6} className="px-5 py-4"><Skeleton className="h-9 w-full" /></td></tr>)
            ) : isError ? (
              <tr><td colSpan={6} className="px-5 py-10 text-center text-danger">Couldn’t load inventory.</td></tr>
            ) : data.data.length === 0 ? (
              <tr><td colSpan={6}><EmptyState title={low ? "Nothing is running low" : "No inventory found"} text={low ? "Every product is above its alert level." : "Try a different search."} /></td></tr>
            ) : (
              data.data.map((i) => (
                <tr key={i.productId} onClick={() => setOpenId(i.productId)} onKeyDown={(e) => e.key === "Enter" && setOpenId(i.productId)} tabIndex={0} className={`cursor-pointer border-b border-line transition-colors last:border-0 hover:bg-sand/50 ${i.isActive ? "" : "opacity-50"}`}>
                  <td className="px-5 py-3">
                    <p className="font-medium">{i.name}{!i.isActive && <span className="ml-2 text-xs font-normal text-mute">(inactive)</span>}</p>
                    <p className="mt-0.5 font-mono text-xs text-mute">{i.sku}</p>
                  </td>
                  <td className={num}>{i.quantityOnHand}</td>
                  <td className={`${num} text-mute`}>{i.reserved}</td>
                  <td className={`${num} font-medium`}>{i.available}</td>
                  <td className={`${num} text-mute`}>{i.lowStockThreshold}</td>
                  <td className="px-5 py-3"><StockBadge status={i.status} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {data && <Pagination page={data.meta.page} totalPages={data.meta.totalPages} onChange={setPage} />}
      <StockPanel productId={openId} onClose={() => setOpenId(null)} />
    </section>
  );
}
