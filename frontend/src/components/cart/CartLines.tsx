"use client";
import Link from "next/link";
import { Minus, Plus, X } from "lucide-react";
import { MAX_PER_LINE, useCart } from "@/lib/cart";
import { money } from "@/lib/format";
import type { CartLine } from "@/lib/types";
import { ProductImage } from "../product/ProductCard";
import { Skeleton } from "../ui/Misc";

const NOTE: Record<string, string> = {
  UNAVAILABLE: "No longer available. Remove it to continue.",
  OUT_OF_STOCK: "Sold out right now.",
};

function Stepper({ line }: { line: CartLine }) {
  const { setQty, busy } = useCart();
  const max = Math.min(MAX_PER_LINE, Math.max(line.available, line.quantity));
  const btn = "grid h-9 w-9 place-items-center text-ink-soft transition-colors hover:bg-sand hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent";
  return (
    <div className="inline-flex items-center rounded-[3px] border border-line bg-paper" role="group" aria-label={`Quantity for ${line.name}`}>
      <button className={btn} disabled={busy || line.quantity <= 1} onClick={() => setQty(line.productId, line.quantity - 1)} aria-label="Decrease quantity"><Minus size={14} /></button>
      <span className="w-8 text-center text-sm tabular-nums" aria-live="polite">{line.quantity}</span>
      <button className={btn} disabled={busy || !line.isActive || line.quantity >= max} onClick={() => setQty(line.productId, line.quantity + 1)} aria-label="Increase quantity"><Plus size={14} /></button>
    </div>
  );
}

export function CartLines({ onNavigate }: { onNavigate?: () => void }) {
  const { view, loading, remove, setQty, busy } = useCart();
  if (loading && view.items.length === 0)
    return <div className="space-y-6">{[0, 1].map((i) => <div key={i} className="flex gap-4"><Skeleton className="h-28 w-24" /><div className="flex-1 space-y-3"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-16" /></div></div>)}</div>;

  return (
    <ul className="divide-y divide-line">
      {view.items.map((l) => {
        const bad = l.issues.length > 0;
        return (
          <li key={l.productId} className="flex gap-4 py-6 first:pt-0">
            <Link href={`/products/${l.productId}`} onClick={onNavigate} className={`block h-28 w-24 shrink-0 overflow-hidden rounded-[3px] bg-sand ${l.isActive ? "" : "pointer-events-none opacity-50"}`}>
              <ProductImage w={240} src={l.imageUrl} alt={l.name} className="h-full w-full object-contain p-2" />
            </Link>
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/products/${l.productId}`} onClick={onNavigate} className="line-clamp-2 font-serif text-lg leading-snug hover:text-gold">{l.name}</Link>
                  {l.isActive && <p className="mt-1 text-sm tabular-nums text-mute">{money(l.unitPrice)}</p>}
                </div>
                <button onClick={() => remove(l.productId)} disabled={busy} aria-label={`Remove ${l.name}`} className="-mr-1 shrink-0 rounded p-1.5 text-mute transition-colors hover:bg-sand hover:text-ink"><X size={16} /></button>
              </div>

              {bad && (
                <p role="status" className="mt-2 text-xs leading-relaxed text-danger">
                  {l.issues.includes("INSUFFICIENT_STOCK") ? (
                    <>Only {l.available} left.{" "}
                      <button onClick={() => setQty(l.productId, l.available)} className="font-medium underline underline-offset-2">Set quantity to {l.available}</button></>
                  ) : (
                    NOTE[l.issues[0]]
                  )}
                </p>
              )}

              <div className="mt-auto flex items-end justify-between pt-4">
                <Stepper line={l} />
                {l.isActive && <p className="text-sm tabular-nums">{money(l.lineTotal)}</p>}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
