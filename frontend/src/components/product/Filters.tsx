"use client";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Minus, Plus } from "lucide-react";
import type { Category, Manufacturer, ProductQuery } from "@/lib/types";
import { Skeleton } from "../ui/Misc";

type Props = {
  query: ProductQuery;
  categories?: Category[];
  manufacturers?: Manufacturer[];
  onChange: (patch: Partial<ProductQuery>) => void;
};

function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-line py-6 first:pt-0">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center justify-between">
        <span className="eyebrow !text-ink">{title}</span>
        <ChevronDown size={16} className={`text-mute transition-transform duration-300 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="mt-5">{children}</div>}
    </section>
  );
}

export function Filters({ query, categories, manufacturers, onChange }: Props) {
  const tree = useMemo(() => {
    const byParent = new Map<string | null, Category[]>();
    categories?.forEach((c) => byParent.set(c.parentId, [...(byParent.get(c.parentId) ?? []), c]));
    return byParent;
  }, [categories]);

  const [min, setMin] = useState(query.minPrice ?? "");
  const [max, setMax] = useState(query.maxPrice ?? "");
  const [allBrands, setAllBrands] = useState(false);
  useEffect(() => {
    setMin(query.minPrice ?? "");
    setMax(query.maxPrice ?? "");
  }, [query.minPrice, query.maxPrice]);

  const applyPrice = () => onChange({ minPrice: min || undefined, maxPrice: max || undefined });
  const brands = allBrands ? manufacturers : manufacturers?.slice(0, 8);
  const row = (active: boolean) => `flex w-full items-center gap-3 py-1.5 text-left text-sm transition-colors ${active ? "text-ink" : "text-ink-soft hover:text-ink"}`;
  const dot = (active: boolean) => <span className={`h-1.5 w-1.5 shrink-0 rounded-full transition-all ${active ? "scale-100 bg-gold" : "scale-0 bg-gold"}`} />;

  const renderTree = (parent: string | null, depth = 0): React.ReactNode =>
    tree.get(parent)?.map((c) => (
      <div key={c.id}>
        <button onClick={() => onChange({ categoryId: query.categoryId === c.id ? undefined : c.id })} className={`${row(query.categoryId === c.id)} capitalize`} style={{ paddingLeft: depth * 14 }}>
          {dot(query.categoryId === c.id)}
          {c.name}
        </button>
        {renderTree(c.id, depth + 1)}
      </div>
    ));

  return (
    <div>
      <Section title="Category">
        {!categories ? (
          <div className="space-y-3">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-4 w-32" />)}</div>
        ) : (
          <div className="max-h-72 overflow-y-auto pr-2">
            <button onClick={() => onChange({ categoryId: undefined })} className={row(!query.categoryId)}>
              {dot(!query.categoryId)}All categories
            </button>
            {renderTree(null)}
          </div>
        )}
      </Section>

      <Section title="Availability">
        <label className="flex cursor-pointer items-center justify-between gap-3 text-sm text-ink-soft">
          In stock only
          <button type="button" role="switch" aria-checked={query.inStock === "true"} aria-label="In stock only" onClick={() => onChange({ inStock: query.inStock === "true" ? undefined : "true" })} className={`relative h-6 w-11 rounded-full transition-colors duration-300 ${query.inStock === "true" ? "bg-ink" : "bg-line"}`}>
            <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-paper shadow transition-transform duration-300 ease-[var(--ease-premium)] ${query.inStock === "true" ? "translate-x-5" : ""}`} />
          </button>
        </label>
      </Section>

      <Section title="Price">
        <div className="flex items-center gap-2">
          <input aria-label="Minimum price" inputMode="decimal" placeholder="Min" value={min} onChange={(e) => setMin(e.target.value.replace(/[^\d.]/g, ""))} onKeyDown={(e) => e.key === "Enter" && applyPrice()} className="h-11 w-full rounded-[3px] border border-line bg-paper px-3 text-sm focus:border-ink focus:outline-none" />
          <Minus size={14} className="shrink-0 text-mute" />
          <input aria-label="Maximum price" inputMode="decimal" placeholder="Max" value={max} onChange={(e) => setMax(e.target.value.replace(/[^\d.]/g, ""))} onKeyDown={(e) => e.key === "Enter" && applyPrice()} className="h-11 w-full rounded-[3px] border border-line bg-paper px-3 text-sm focus:border-ink focus:outline-none" />
        </div>
        <button onClick={applyPrice} className="mt-3 h-10 w-full rounded-[3px] border border-ink/80 text-xs font-medium tracking-wide transition-colors hover:bg-ink hover:text-ivory">
          Apply
        </button>
      </Section>

      <Section title="Brand" defaultOpen={false}>
        {!manufacturers ? (
          <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-4 w-28" />)}</div>
        ) : manufacturers.length === 0 ? (
          <p className="text-sm text-mute">No brands yet.</p>
        ) : (
          <>
            {brands?.map((m) => (
              <button key={m.id} onClick={() => onChange({ manufacturerId: query.manufacturerId === m.id ? undefined : m.id })} className={row(query.manufacturerId === m.id)}>
                {dot(query.manufacturerId === m.id)}
                {m.name}
              </button>
            ))}
            {manufacturers.length > 8 && (
              <button onClick={() => setAllBrands((a) => !a)} className="mt-2 flex items-center gap-1.5 text-xs text-gold hover:underline">
                {allBrands ? <Minus size={12} /> : <Plus size={12} />} {allBrands ? "Show fewer" : `Show all ${manufacturers.length}`}
              </button>
            )}
          </>
        )}
      </Section>
    </div>
  );
}
