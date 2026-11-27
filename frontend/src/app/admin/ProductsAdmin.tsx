"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, ExternalLink, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState, Skeleton } from "@/components/ui/Misc";
import { Pagination } from "@/components/product/Pagination";
import { ProductImage } from "@/components/product/ProductCard";
import { api, ApiError } from "@/lib/api";
import { money } from "@/lib/format";
import { useProducts } from "@/lib/hooks";
import { useToast } from "@/lib/toast";
import type { ProductSummary } from "@/lib/types";
import { ProductForm } from "./ProductForm";
import { StockBadge } from "./StockBadge";

export function ProductsAdmin() {
  const qc = useQueryClient();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<ProductSummary | "new" | null>(null);
  const [removing, setRemoving] = useState<ProductSummary | null>(null);
  const { data, isPending, isError } = useProducts({ q: q || undefined, page, limit: 10, sort: q ? undefined : "newest" });

  useEffect(() => {
    const t = setTimeout(() => { setQ(text.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [text]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["products"] });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/products/${id}`),
    onSuccess: () => { refresh(); setRemoving(null); toast.success("Product deactivated and hidden from the shop."); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not deactivate."),
  });
  const importer = useMutation({
    mutationFn: () => api.post<{ inserted: number; updated: number }>("/api/products/import", { limit: 30 }),
    onSuccess: (r) => {
      ["products", "categories", "manufacturers"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast.success(`Import complete: ${r.inserted} added, ${r.updated} updated.`);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Import failed."),
  });

  return (
    <section>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative block w-full sm:w-80">
          <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-mute" />
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search products" aria-label="Search products" className="h-11 w-full rounded-[3px] border border-line bg-paper pl-10 pr-3 text-sm focus:border-ink focus:outline-none" />
        </label>
        <div className="flex gap-3">
          <Button variant="outline" loading={importer.isPending} onClick={() => importer.mutate()} title="Imports 30 sample products from DummyJSON (safe to repeat)">
            <Download size={15} /> Import sample catalog
          </Button>
          <Button onClick={() => setEditing("new")}><Plus size={16} /> New product</Button>
        </div>
      </div>

      <div className="mt-8 overflow-x-auto rounded-[3px] border border-line bg-paper">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-line">
              {["Product", "Brand", "Stock", "Price", ""].map((h, i) => <th key={i} className={`eyebrow px-5 py-4 font-medium ${i === 3 ? "text-right" : ""}`}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {isPending ? (
              Array.from({ length: 6 }, (_, i) => <tr key={i} className="border-b border-line last:border-0"><td colSpan={5} className="px-5 py-4"><Skeleton className="h-12 w-full" /></td></tr>)
            ) : isError ? (
              <tr><td colSpan={5} className="px-5 py-10 text-center text-danger">Couldn’t load products.</td></tr>
            ) : data.data.length === 0 ? (
              <tr><td colSpan={5}><EmptyState title="No products" text={q ? "Nothing matches your search." : "Add your first product, or import the sample catalog to get started."} /></td></tr>
            ) : (
              data.data.map((p) => (
                <tr key={p.id} className="border-b border-line transition-colors last:border-0 hover:bg-sand/40">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-4">
                      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-[3px] bg-sand"><ProductImage w={140} src={p.imageUrl} alt={p.name} className="h-full w-full object-contain p-1.5" /></div>
                      <div className="min-w-0">
                        <p className="truncate font-medium">{p.name}</p>
                        <p className="mt-0.5 font-mono text-xs text-mute">{p.sku}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-ink-soft">{p.manufacturer?.name ?? "—"}</td>
                  <td className="px-5 py-3"><StockBadge status={p.stockStatus} left={p.stockLeft} /></td>
                  <td className="px-5 py-3 text-right tabular-nums">{money(p.price)}</td>
                  <td className="px-5 py-3">
                    <div className="flex justify-end gap-1">
                      <Link href={`/products/${p.id}`} target="_blank" aria-label={`View ${p.name}`} className="rounded p-2 text-mute transition-colors hover:bg-sand hover:text-ink"><ExternalLink size={16} /></Link>
                      <button onClick={() => setEditing(p)} aria-label={`Edit ${p.name}`} className="rounded p-2 text-mute transition-colors hover:bg-sand hover:text-ink"><Pencil size={16} /></button>
                      <button onClick={() => setRemoving(p)} aria-label={`Deactivate ${p.name}`} className="rounded p-2 text-mute transition-colors hover:bg-[#f8e4e2] hover:text-danger"><Trash2 size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {data && <Pagination page={data.meta.page} totalPages={data.meta.totalPages} onChange={setPage} />}

      <ProductForm key={editing === "new" ? "new" : editing?.id ?? "closed"} target={editing} onClose={() => setEditing(null)} onSaved={() => { refresh(); setEditing(null); }} />
      <ConfirmDialog open={!!removing} title="Deactivate this product?" message={removing ? `“${removing.name}” will be hidden from the shop. Existing order history is kept, and you can reactivate it later.` : ""} confirmLabel="Deactivate" loading={remove.isPending} onConfirm={() => removing && remove.mutate(removing.id)} onClose={() => setRemoving(null)} />
    </section>
  );
}
