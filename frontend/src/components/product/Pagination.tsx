import { ChevronLeft, ChevronRight } from "lucide-react";

function range(page: number, total: number): (number | "…")[] {
  const set = new Set([1, total, page - 1, page, page + 1].filter((n) => n >= 1 && n <= total));
  const out: (number | "…")[] = [];
  [...set].sort((a, b) => a - b).forEach((n, idx, arr) => {
    if (idx && n - arr[idx - 1] > 1) out.push("…");
    out.push(n);
  });
  return out;
}

export function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  if (totalPages <= 1) return null;
  const btn = "grid h-10 min-w-10 place-items-center rounded-[3px] px-2 text-sm tabular-nums transition-colors";
  return (
    <nav aria-label="Pagination" className="mt-16 flex items-center justify-center gap-1.5">
      <button disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Previous page" className={`${btn} text-ink-soft hover:bg-sand disabled:opacity-30`}>
        <ChevronLeft size={18} />
      </button>
      {range(page, totalPages).map((n, i) =>
        n === "…" ? (
          <span key={`g${i}`} className="px-1 text-mute">…</span>
        ) : (
          <button key={n} onClick={() => onChange(n)} aria-current={n === page ? "page" : undefined} className={`${btn} ${n === page ? "bg-ink text-ivory" : "text-ink-soft hover:bg-sand"}`}>
            {n}
          </button>
        ),
      )}
      <button disabled={page >= totalPages} onClick={() => onChange(page + 1)} aria-label="Next page" className={`${btn} text-ink-soft hover:bg-sand disabled:opacity-30`}>
        <ChevronRight size={18} />
      </button>
    </nav>
  );
}
