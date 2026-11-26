import type { StockStatus } from "@/lib/types";

// Storefront availability. IN_STOCK shows nothing on cards (quiet by default) and a calm line on the detail page.
export function StockPill({ status, left, detail = false }: { status: StockStatus; left: number | null; detail?: boolean }) {
  if (status === "OUT_OF_STOCK")
    return <span className="inline-flex items-center gap-2 rounded-full bg-ink px-3 py-1 text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-ivory">Sold out</span>;
  if (status === "LOW_STOCK")
    return (
      <span className="inline-flex items-center gap-2 rounded-full bg-gold-soft px-3 py-1 text-[0.6875rem] font-medium tracking-wide text-[#7a5a28]">
        <span className="h-1.5 w-1.5 rounded-full bg-gold" /> Only {left} left
      </span>
    );
  return detail ? (
    <span className="inline-flex items-center gap-2 text-sm text-ok"><span className="h-1.5 w-1.5 rounded-full bg-ok" /> In stock</span>
  ) : null;
}
