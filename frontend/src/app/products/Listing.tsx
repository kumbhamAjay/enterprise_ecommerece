"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { useCategories, useManufacturers, useProducts } from "@/lib/hooks";
import type { ProductQuery } from "@/lib/types";
import { Filters } from "@/components/product/Filters";
import { Pagination } from "@/components/product/Pagination";
import { ProductCard, ProductCardSkeleton, gridClass } from "@/components/product/ProductCard";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Container, EmptyState, Skeleton } from "@/components/ui/Misc";

const SORTS = [
  ["relevance", "Relevance"],
  ["newest", "Newest"],
  ["price_asc", "Price: low to high"],
  ["price_desc", "Price: high to low"],
  ["name", "Name: A to Z"],
] as const;
const LIMIT = 12;

export function ListingSkeleton() {
  return (
    <Container className="py-14">
      <Skeleton className="h-12 w-72" />
      <div className={`mt-14 ${gridClass}`}>{Array.from({ length: 8 }, (_, i) => <ProductCardSkeleton key={i} />)}</div>
    </Container>
  );
}

export function Listing() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  // The URL is the single source of truth for filters: shareable, back-button friendly.
  const query: ProductQuery = {
    q: sp.get("q") ?? undefined,
    categoryId: sp.get("categoryId") ?? undefined,
    manufacturerId: sp.get("manufacturerId") ?? undefined,
    minPrice: sp.get("minPrice") ?? undefined,
    maxPrice: sp.get("maxPrice") ?? undefined,
    inStock: sp.get("inStock") === "true" ? "true" : undefined,
    sort: sp.get("sort") ?? undefined,
    page: Math.max(1, Number(sp.get("page")) || 1),
    limit: LIMIT,
  };

  const update = useCallback(
    (patch: Partial<ProductQuery>) => {
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === "" || (k === "page" && v === 1)) next.delete(k);
        else next.set(k, String(v));
      }
      if (!("page" in patch)) next.delete("page"); // any filter change returns to page 1
      router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
    },
    [sp, router, pathname],
  );

  const { data, isPending, isError, isPlaceholderData, refetch } = useProducts(query);
  const { data: categories } = useCategories();
  const { data: manufacturers } = useManufacturers();
  const [sheet, setSheet] = useState(false);

  // Debounced search box (350ms) -> URL
  const [text, setText] = useState(query.q ?? "");
  const lastQ = useRef(query.q);
  useEffect(() => {
    if (query.q !== lastQ.current) setText(query.q ?? ""); // external change (header search / back button)
    lastQ.current = query.q;
  }, [query.q]);
  useEffect(() => {
    const t = setTimeout(() => text.trim() !== (query.q ?? "") && update({ q: text.trim() || undefined }), 350);
    return () => clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  const sort = query.sort ?? (query.q ? "relevance" : "newest");
  const catName = categories?.find((c) => c.id === query.categoryId)?.name;
  const brandName = manufacturers?.find((m) => m.id === query.manufacturerId)?.name;
  const chips = [
    query.q && { label: `“${query.q}”`, clear: { q: undefined } },
    catName && { label: catName, clear: { categoryId: undefined } },
    brandName && { label: brandName, clear: { manufacturerId: undefined } },
    query.inStock && { label: "In stock", clear: { inStock: undefined } },
    (query.minPrice || query.maxPrice) && { label: `$${query.minPrice || 0} – ${query.maxPrice ? `$${query.maxPrice}` : "any"}`, clear: { minPrice: undefined, maxPrice: undefined } },
  ].filter(Boolean) as { label: string; clear: Partial<ProductQuery> }[];

  const filters = <Filters query={query} categories={categories} manufacturers={manufacturers} onChange={update} />;
  const total = data?.meta.total ?? 0;

  return (
    <Container className="py-12 lg:py-16">
      <div className="reveal flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="eyebrow flex items-center gap-4"><span className="h-px w-8 bg-gold" /> The collection</p>
          <h1 className="mt-4 font-serif text-5xl font-light capitalize tracking-tight sm:text-6xl">{catName ?? "All products"}</h1>
        </div>
        <label className="relative block w-full lg:w-96">
          <Search size={17} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-mute" />
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search products" aria-label="Search products" className="h-12 w-full rounded-[3px] border border-line bg-paper pl-11 pr-10 text-sm placeholder:text-mute/70 hover:border-ink/40 focus:border-ink focus:outline-none" />
          {text && (
            <button onClick={() => setText("")} aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-1 text-mute hover:text-ink"><X size={15} /></button>
          )}
        </label>
      </div>

      <div className="mt-10 flex items-center justify-between gap-4 border-y border-line py-4">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" className="lg:hidden" onClick={() => setSheet(true)}>
            <SlidersHorizontal size={14} /> Filters
          </Button>
          <p aria-live="polite" className="text-sm text-mute">{isPending ? "Loading…" : `${total} ${total === 1 ? "piece" : "pieces"}`}</p>
        </div>
        <label className="flex items-center gap-3 text-sm">
          <span className="eyebrow hidden sm:inline">Sort by</span>
          <select value={sort} onChange={(e) => update({ sort: e.target.value })} className="h-10 rounded-[3px] border border-line bg-paper px-3 text-sm focus:border-ink focus:outline-none">
            {SORTS.filter(([v]) => v !== "relevance" || query.q).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      </div>

      {chips.length > 0 && (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          {chips.map((c) => (
            <button key={c.label} onClick={() => update(c.clear)} className="group inline-flex items-center gap-2 rounded-full border border-line bg-paper px-3.5 py-1.5 text-xs capitalize transition-colors hover:border-ink">
              {c.label} <X size={12} className="text-mute group-hover:text-ink" />
            </button>
          ))}
          <button onClick={() => update({ q: undefined, categoryId: undefined, manufacturerId: undefined, minPrice: undefined, maxPrice: undefined, inStock: undefined, sort: undefined })} className="px-2 text-xs text-gold hover:underline">Clear all</button>
        </div>
      )}

      <div className="mt-10 grid gap-12 lg:grid-cols-[250px_1fr]">
        <aside className="hidden lg:block"><div className="sticky top-28">{filters}</div></aside>

        <div>
          {isError ? (
            <EmptyState title="We couldn't load the collection" text="The catalog service didn't respond. Please try again." action={<Button onClick={() => refetch()}>Try again</Button>} />
          ) : isPending ? (
            <div className={gridClass.replace("xl:grid-cols-4", "xl:grid-cols-3")}>{Array.from({ length: 6 }, (_, i) => <ProductCardSkeleton key={i} />)}</div>
          ) : data.data.length === 0 ? (
            <EmptyState title="Nothing matches" text="Try removing a filter or searching for something broader." action={<Button variant="outline" onClick={() => update({ q: undefined, categoryId: undefined, manufacturerId: undefined, minPrice: undefined, maxPrice: undefined, inStock: undefined })}>Clear filters</Button>} />
          ) : (
            <>
              <div className={`${gridClass.replace("xl:grid-cols-4", "xl:grid-cols-3")} transition-opacity duration-300 ${isPlaceholderData ? "opacity-50" : ""}`}>
                {data.data.map((p) => <ProductCard key={p.id} p={p} />)}
              </div>
              <Pagination page={data.meta.page} totalPages={data.meta.totalPages} onChange={(p) => { update({ page: p }); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
            </>
          )}
        </div>
      </div>

      <Modal open={sheet} onClose={() => setSheet(false)} title="Filters" side="left">
        {filters}
        <Button className="mt-6 w-full" onClick={() => setSheet(false)}>Show {total} {total === 1 ? "piece" : "pieces"}</Button>
      </Modal>
    </Container>
  );
}
