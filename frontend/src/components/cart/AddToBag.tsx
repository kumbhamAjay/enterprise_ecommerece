"use client";
import { useState } from "react";
import { Minus, Plus, ShoppingBag } from "lucide-react";
import { MAX_PER_LINE, useCart } from "@/lib/cart";
import type { StockStatus } from "@/lib/types";
import { Button } from "../ui/Button";

export function AddToBag({ productId, stockStatus, stockLeft }: { productId: string; stockStatus: StockStatus; stockLeft: number | null }) {
  const { add, setOpen, busy } = useCart();
  const [qty, setQty] = useState(1);
  const max = stockStatus === "LOW_STOCK" && stockLeft ? Math.min(stockLeft, MAX_PER_LINE) : MAX_PER_LINE;

  if (stockStatus === "OUT_OF_STOCK")
    return <Button size="lg" className="w-full" disabled>Sold out</Button>;

  async function submit() {
    if (await add(productId, qty, { stockStatus, stockLeft })) {
      setQty(1);
      setOpen(true);
    }
  }
  const btn = "grid h-full w-11 place-items-center text-ink-soft transition-colors hover:bg-sand disabled:opacity-30";
  return (
    <div className="flex gap-3">
      <div className="inline-flex h-[52px] items-center rounded-[3px] border border-line bg-paper" role="group" aria-label="Quantity">
        <button className={btn} onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1} aria-label="Decrease quantity"><Minus size={15} /></button>
        <span className="w-8 text-center text-sm tabular-nums" aria-live="polite">{qty}</span>
        <button className={btn} onClick={() => setQty((q) => Math.min(max, q + 1))} disabled={qty >= max} aria-label="Increase quantity"><Plus size={15} /></button>
      </div>
      <Button size="lg" className="h-[52px] flex-1" loading={busy} onClick={submit}><ShoppingBag size={17} /> Add to bag</Button>
    </div>
  );
}
