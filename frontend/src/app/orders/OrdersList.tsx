"use client";
import Link from "next/link";
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { useRequireAuth } from "@/lib/guards";
import { useOrders } from "@/lib/hooks";
import { money } from "@/lib/format";
import { Pagination } from "@/components/product/Pagination";
import { ProductImage } from "@/components/product/ProductCard";
import { StatusBadge } from "@/components/orders/StatusBadge";
import { LinkButton } from "@/components/ui/Button";
import { Container, EmptyState, Skeleton } from "@/components/ui/Misc";

export const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

export function OrdersList() {
  const { allowed } = useRequireAuth();
  const [page, setPage] = useState(1);
  const { data, isPending, isError } = useOrders(page);

  return (
    <Container className="py-12 lg:py-16">
      <div className="reveal">
        <p className="eyebrow flex items-center gap-4"><span className="h-px w-8 bg-gold" /> Your account</p>
        <h1 className="mt-4 font-serif text-5xl font-light tracking-tight">Orders</h1>
      </div>
      <div className="mt-12">
        {!allowed || isPending ? (
          <div className="space-y-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28" />)}</div>
        ) : isError ? (
          <p className="text-sm text-danger">We couldn’t load your orders.</p>
        ) : data.data.length === 0 ? (
          <EmptyState title="No orders yet" text="When you place an order, you’ll be able to follow it here." action={<LinkButton href="/products">Explore the collection</LinkButton>} />
        ) : (
          <>
            <ul className="space-y-4">
              {data.data.map((o) => (
                <li key={o.id}>
                  <Link href={`/orders/${o.id}`} className="group flex items-center gap-5 rounded-[3px] border border-line bg-paper p-5 transition-all duration-300 hover:border-ink/40 hover:shadow-[0_18px_40px_-26px_rgba(20,17,15,0.35)]">
                    <div className="hidden shrink-0 -space-x-4 sm:flex">
                      {(o.thumbs.length ? o.thumbs : [null]).map((t, i) => (
                        <div key={i} className="h-16 w-16 overflow-hidden rounded-full border-2 border-paper bg-sand"><ProductImage w={140} src={t} alt="" className="h-full w-full object-contain p-1.5" /></div>
                      ))}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                        <p className="font-mono text-sm">{o.orderNumber}</p>
                        <StatusBadge status={o.status} />
                      </div>
                      <p className="mt-2 text-sm text-mute">{fmtDate(o.placedAt)} · {o.itemCount} {o.itemCount === 1 ? "item" : "items"}</p>
                    </div>
                    <p className="font-serif text-xl tabular-nums">{money(o.total)}</p>
                    <ChevronRight size={18} className="text-mute transition-transform duration-300 group-hover:translate-x-1" />
                  </Link>
                </li>
              ))}
            </ul>
            <Pagination page={data.meta.page} totalPages={data.meta.totalPages} onChange={setPage} />
          </>
        )}
      </div>
    </Container>
  );
}
