import Link from "next/link";
import { money } from "@/lib/format";
import { imgUrl } from "@/lib/image";
import type { ProductSummary } from "@/lib/types";
import { Skeleton } from "../ui/Misc";
import { StockPill } from "./StockPill";

export function ProductImage({ src, alt, className = "", w = 800 }: { src: string | null; alt: string; className?: string; w?: number }) {
  if (!src)
    return (
      <div className={`grid h-full w-full place-items-center bg-sand ${className}`}>
        <span className="font-serif text-4xl tracking-widest text-gold/60">{alt[0]?.toUpperCase()}</span>
      </div>
    );
  // eslint-disable-next-line @next/next/no-img-element -- admin-entered URLs can point at any host
  return <img src={imgUrl(src, w) ?? src} alt={alt} loading="lazy" decoding="async" className={className} />;
}

export function ProductCard({ p, priority = false }: { p: ProductSummary; priority?: boolean }) {
  return (
    <Link href={`/products/${p.id}`} className="group block">
      <div className="relative aspect-[4/5] overflow-hidden rounded-[3px] bg-sand">
        <ProductImage w={640} src={p.imageUrl} alt={p.name} className={`h-full w-full object-contain p-8 transition-all duration-[900ms] ease-[var(--ease-premium)] group-hover:scale-[1.06] ${p.stockStatus === "OUT_OF_STOCK" ? "opacity-40 grayscale" : ""}`} />
        {p.stockStatus !== "IN_STOCK" && <div className="absolute left-3 top-3"><StockPill status={p.stockStatus} left={p.stockLeft} /></div>}
        <span className="absolute inset-x-4 bottom-4 translate-y-3 rounded-[3px] bg-paper/90 py-2.5 text-center text-[0.6875rem] font-medium uppercase tracking-[0.18em] opacity-0 backdrop-blur transition-all duration-500 ease-[var(--ease-premium)] group-hover:translate-y-0 group-hover:opacity-100">
          View details
        </span>
      </div>
      <div className="mt-4 space-y-1.5">
        <p className="eyebrow truncate">{p.manufacturer?.name ?? " "}</p>
        <h3 className="line-clamp-2 min-h-[2.6em] font-serif text-[1.0625rem] leading-snug transition-colors group-hover:text-gold">{p.name}</h3>
        <p className="text-sm tabular-nums text-ink-soft">{money(p.price)}</p>
      </div>
    </Link>
  );
}

export function ProductCardSkeleton() {
  return (
    <div>
      <Skeleton className="aspect-[4/5]" />
      <Skeleton className="mt-4 h-2.5 w-16" />
      <Skeleton className="mt-3 h-4 w-3/4" />
      <Skeleton className="mt-3 h-3 w-14" />
    </div>
  );
}

export const gridClass = "grid grid-cols-2 gap-x-5 gap-y-10 sm:gap-x-7 lg:grid-cols-3 xl:grid-cols-4";
