import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { serverGet } from "@/lib/server-api";
import { money } from "@/lib/format";
import type { ProductDetail } from "@/lib/types";
import { Gallery } from "@/components/product/Gallery";
import { StockPill } from "@/components/product/StockPill";
import { AddToBag } from "@/components/cart/AddToBag";
import { Container } from "@/components/ui/Misc";

type Props = { params: Promise<{ id: string }> };

const load = async (id: string) => (/^\d+$/.test(id) ? (await serverGet<{ data: ProductDetail }>(`/api/products/${id}`, 60))?.data ?? null : null);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await load((await params).id);
  return p ? { title: p.name, description: p.description?.slice(0, 155) } : { title: "Not found" };
}

export default async function ProductPage({ params }: Props) {
  const p = await load((await params).id);
  if (!p) notFound();
  const category = p.categories[0];

  return (
    <Container className="py-8 lg:py-12">
      <nav aria-label="Breadcrumb" className="mb-8 flex flex-wrap items-center gap-2 text-xs text-mute">
        <Link href="/products" className="hover:text-ink">Shop</Link>
        {category && (
          <>
            <ChevronRight size={12} />
            <Link href={`/products?categoryId=${category.id}`} className="capitalize hover:text-ink">{category.name}</Link>
          </>
        )}
        <ChevronRight size={12} />
        <span className="max-w-[16rem] truncate text-ink-soft">{p.name}</span>
      </nav>

      <div className="grid gap-12 lg:grid-cols-[1.15fr_1fr] lg:gap-20">
        <div className="reveal"><Gallery images={p.images} name={p.name} /></div>

        <div className="reveal lg:sticky lg:top-28 lg:self-start [animation-delay:120ms]">
          {p.manufacturer && (
            <Link href={`/products?manufacturerId=${p.manufacturer.id}`} className="eyebrow !text-gold hover:underline">{p.manufacturer.name}</Link>
          )}
          <h1 className="mt-4 font-serif text-4xl font-light leading-[1.05] tracking-tight sm:text-5xl">{p.name}</h1>
          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
            <p className="text-2xl tabular-nums">{money(p.price)}</p>
            <StockPill status={p.stockStatus} left={p.stockLeft} detail />
          </div>

          <div className="my-9 h-px bg-line" />

          {p.description && <p className="text-[0.9375rem] leading-[1.8] text-ink-soft">{p.description}</p>}

          <dl className="mt-9 grid grid-cols-[110px_1fr] gap-y-4 border-t border-line pt-8 text-sm">
            <dt className="eyebrow self-center">SKU</dt>
            <dd className="font-mono text-xs text-ink-soft">{p.sku}</dd>
            {p.manufacturer && (<><dt className="eyebrow self-center">Brand</dt><dd>{p.manufacturer.name}</dd></>)}
            {p.categories.length > 0 && (
              <>
                <dt className="eyebrow self-center">Category</dt>
                <dd className="flex flex-wrap gap-2">
                  {p.categories.map((c) => (
                    <Link key={c.id} href={`/products?categoryId=${c.id}`} className="rounded-full border border-line px-3 py-1 text-xs capitalize transition-colors hover:border-ink">{c.name}</Link>
                  ))}
                </dd>
              </>
            )}
          </dl>

          <div className="mt-10">
            <AddToBag productId={p.id} stockStatus={p.stockStatus} stockLeft={p.stockLeft} />
            <p className="mt-4 text-xs leading-relaxed text-mute">Your bag is saved, even if you sign in later. Checkout opens with the orders release.</p>
          </div>
        </div>
      </div>
    </Container>
  );
}
