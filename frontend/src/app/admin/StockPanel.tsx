"use client";
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Misc";
import { api, ApiError } from "@/lib/api";
import { useInventoryItem, useLedger } from "@/lib/hooks";
import { useToast } from "@/lib/toast";
import type { LedgerEntry } from "@/lib/types";
import { StockBadge } from "./StockBadge";

const TYPE_LABEL: Record<LedgerEntry["type"], string> = {
  INITIAL: "Initial stock", RESTOCK: "Restock", CORRECTION: "Correction", DAMAGED: "Damaged", RETURN: "Return",
  RESERVE: "Held for a customer", RELEASE: "Hold released", EXPIRE: "Hold expired", SALE: "Sold",
};
const signed = (n: number) => `${n > 0 ? "+" : "−"}${Math.abs(n)}`;

export function StockPanel({ productId, onClose }: { productId: string | null; onClose: () => void }) {
  const { data: item, isPending } = useInventoryItem(productId);
  const [page, setPage] = useState(1);
  const { data: ledger } = useLedger(productId, page);
  const qc = useQueryClient();
  const toast = useToast();

  const [type, setType] = useState("RESTOCK");
  const [direction, setDirection] = useState<"add" | "remove">("add");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [count, setCount] = useState("");
  const [threshold, setThreshold] = useState("");

  // a different product starts from a clean form (otherwise a leftover "Damaged" would apply to the next product)
  useEffect(() => { setPage(1); setType("RESTOCK"); setDirection("add"); setQty(""); setNote(""); setCount(""); }, [productId]);
  useEffect(() => { if (item) setThreshold(String(item.lowStockThreshold)); }, [item]);

  const refresh = () => ["inventory", "products", "product"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const onError = (e: unknown) => toast.error(e instanceof ApiError ? e.message : "Something went wrong.");

  const adjust = useMutation({
    mutationFn: () => {
      const n = Math.abs(Number(qty));
      const delta = type === "RESTOCK" || type === "RETURN" ? n : type === "DAMAGED" ? -n : direction === "add" ? n : -n;
      return api.post(`/api/inventory/${productId}/adjust`, { delta, type, note: note.trim() || undefined });
    },
    onSuccess: () => { refresh(); setQty(""); setNote(""); toast.success("Stock updated."); },
    onError,
  });
  const setStock = useMutation({
    mutationFn: () => api.put(`/api/inventory/${productId}/stock`, { quantity: Number(count) }),
    onSuccess: () => { refresh(); setCount(""); toast.success("Stock count saved."); },
    onError,
  });
  const saveThreshold = useMutation({
    mutationFn: () => api.patch(`/api/inventory/${productId}`, { lowStockThreshold: Number(threshold) }),
    onSuccess: () => { refresh(); toast.success("Alert level saved."); },
    onError,
  });

  const validQty = /^\d+$/.test(qty) && Number(qty) > 0;
  const validCount = /^\d+$/.test(count);
  const validThreshold = /^\d+$/.test(threshold) && Number(threshold) !== item?.lowStockThreshold;

  return (
    <Modal open={!!productId} onClose={onClose} title="Manage stock" side="right" wide>
      {isPending || !item ? (
        <div className="space-y-4"><Skeleton className="h-8 w-2/3" /><Skeleton className="h-24" /><Skeleton className="h-48" /></div>
      ) : (
        <div className="space-y-10">
          <div>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="font-serif text-2xl leading-tight">{item.name}</h3>
                <p className="mt-1 font-mono text-xs text-mute">{item.sku}</p>
              </div>
              <StockBadge status={item.status} />
            </div>
            <dl className="mt-6 grid grid-cols-3 divide-x divide-line rounded-[3px] border border-line bg-paper text-center">
              {[["On hand", item.quantityOnHand], ["Reserved", item.reserved], ["Available", item.available]].map(([l, v]) => (
                <div key={l} className="px-3 py-4">
                  <dd className="font-serif text-3xl tabular-nums">{v}</dd>
                  <dt className="eyebrow mt-1">{l}</dt>
                </div>
              ))}
            </dl>
            {item.reserved > 0 && <p className="mt-3 text-xs text-mute">{item.reserved} unit{item.reserved === 1 ? " is" : "s are"} held in customers’ carts and can’t be removed.</p>}
          </div>

          <form onSubmit={(e) => { e.preventDefault(); if (validQty) adjust.mutate(); }} className="space-y-4">
            <h4 className="eyebrow !text-ink">Add or remove stock</h4>
            <div className="grid grid-cols-2 gap-4">
              <Select label="Reason" value={type} onChange={(e) => setType(e.target.value)}>
                <option value="RESTOCK">Restock (delivery)</option>
                <option value="RETURN">Customer return</option>
                <option value="DAMAGED">Damaged / lost</option>
                <option value="CORRECTION">Correction</option>
              </Select>
              {type === "CORRECTION" ? (
                <Select label="Direction" value={direction} onChange={(e) => setDirection(e.target.value as "add" | "remove")}>
                  <option value="add">Add units</option>
                  <option value="remove">Remove units</option>
                </Select>
              ) : (
                <div />
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Input label="Quantity" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))} placeholder="0" />
              <Input label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. PO #1042" />
            </div>
            <Button type="submit" loading={adjust.isPending} disabled={!validQty}>Apply</Button>
          </form>

          <div className="grid gap-8 sm:grid-cols-2">
            <form onSubmit={(e) => { e.preventDefault(); if (validCount) setStock.mutate(); }} className="space-y-4">
              <h4 className="eyebrow !text-ink">Stock count</h4>
              <Input label="Exact units on shelf" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ""))} placeholder={String(item.quantityOnHand)} hint="Sets on-hand to this number." />
              <Button type="submit" variant="outline" loading={setStock.isPending} disabled={!validCount}>Save count</Button>
            </form>
            <form onSubmit={(e) => { e.preventDefault(); if (validThreshold) saveThreshold.mutate(); }} className="space-y-4">
              <h4 className="eyebrow !text-ink">Low-stock alert</h4>
              <Input label="Alert at or below" inputMode="numeric" value={threshold} onChange={(e) => setThreshold(e.target.value.replace(/\D/g, ""))} hint="Admins are emailed when stock crosses this." />
              <Button type="submit" variant="outline" loading={saveThreshold.isPending} disabled={!validThreshold}>Save level</Button>
            </form>
          </div>

          <div>
            <h4 className="eyebrow !text-ink">History</h4>
            <ol className="mt-4 divide-y divide-line border-y border-line">
              {!ledger ? <li className="py-4"><Skeleton className="h-10" /></li> : ledger.data.map((t) => (
                <li key={t.id} className="flex items-start justify-between gap-4 py-3.5">
                  <div className="min-w-0">
                    <p className="text-sm">{TYPE_LABEL[t.type]}{t.note && <span className="text-mute"> · {t.note}</span>}</p>
                    <p className="mt-0.5 text-xs text-mute">{new Date(t.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} · {t.actorName ?? "System"}</p>
                  </div>
                  <div className="shrink-0 text-right text-xs tabular-nums">
                    {t.quantityDelta !== 0 && <p className={t.quantityDelta > 0 ? "text-ok" : "text-danger"}>{signed(t.quantityDelta)} on hand</p>}
                    {t.reservedDelta !== 0 && <p className="text-mute">{signed(t.reservedDelta)} held</p>}
                    <p className="mt-0.5 text-mute">→ {t.onHandAfter - t.reservedAfter} available</p>
                  </div>
                </li>
              ))}
            </ol>
            {ledger && ledger.meta.totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between text-xs text-mute">
                <span>Page {ledger.meta.page} of {ledger.meta.totalPages}</span>
                <div className="flex gap-1">
                  <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Newer entries" className="rounded p-2 hover:bg-sand disabled:opacity-30"><ChevronLeft size={16} /></button>
                  <button disabled={page >= ledger.meta.totalPages} onClick={() => setPage((p) => p + 1)} aria-label="Older entries" className="rounded p-2 hover:bg-sand disabled:opacity-30"><ChevronRight size={16} /></button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
