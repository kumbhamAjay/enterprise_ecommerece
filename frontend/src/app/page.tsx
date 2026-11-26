import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { serverGet } from "@/lib/server-api";
import type { Category, Page, ProductSummary } from "@/lib/types";
import { ProductCard, ProductImage, gridClass } from "@/components/product/ProductCard";
import { Container } from "@/components/ui/Misc";
import { LinkButton } from "@/components/ui/Button";

async function getHome() {
  const [latest, cats] = await Promise.all([
    serverGet<Page<ProductSummary>>("/api/products?sort=newest&limit=8"),
    serverGet<{ data: Category[] }>("/api/categories"),
  ]);
  // One representative product per top-level category (for the tile image)
  const roots = (cats?.data ?? []).filter((c) => !c.parentId).slice(0, 8);
  const tiles = (
    await Promise.all(
      roots.map(async (c) => {
        const r = await serverGet<Page<ProductSummary>>(`/api/products?categoryId=${c.id}&limit=1`);
        return r?.data[0] ? { category: c, image: r.data[0].imageUrl, total: r.meta.total } : null;
      }),
    )
  )
    .filter((t) => t !== null)
    .slice(0, 4);
  return { products: latest?.data ?? [], tiles };
}

export default async function Home() {
  const { products, tiles } = await getHome();
  const hero = products.slice(0, 3);

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <Container className="grid items-center gap-12 pb-20 pt-10 lg:min-h-[640px] lg:grid-cols-[1.05fr_1fr] lg:gap-8 lg:pb-28 lg:pt-16">
          <div className="reveal max-w-xl">
            <p className="eyebrow flex items-center gap-4">
              <span className="h-px w-10 bg-gold" /> The new season
            </p>
            <h1 className="mt-8 font-serif text-[clamp(2.75rem,6.4vw,5.5rem)] font-light leading-[0.98] tracking-tight">
              Considered objects for <em className="font-normal italic text-gold">everyday</em> life.
            </h1>
            <p className="mt-8 max-w-md text-[1.0625rem] leading-relaxed text-ink-soft">
              A carefully edited collection of things that earn their place — chosen for quality, honest pricing and the way they age.
            </p>
            <div className="mt-11 flex flex-wrap items-center gap-4">
              <LinkButton href="/products" size="lg">
                Explore the collection <ArrowRight size={16} />
              </LinkButton>
              <Link href="/products?sort=newest" className="group inline-flex items-center gap-2 px-2 py-3 text-sm tracking-wide text-ink-soft transition-colors hover:text-ink">
                New arrivals <ArrowUpRight size={15} className="transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </Link>
            </div>
          </div>

          {hero.length > 0 && (
            <div className="reveal relative mx-auto grid w-full max-w-xl grid-cols-2 gap-4 [animation-delay:150ms]" aria-hidden>
              <Link href={`/products/${hero[0].id}`} tabIndex={-1} className="group relative row-span-2 aspect-[3/5] overflow-hidden rounded-[3px] bg-sand">
                <ProductImage src={hero[0].imageUrl} alt={hero[0].name} className="h-full w-full object-contain p-6 transition-transform duration-[1200ms] ease-[var(--ease-premium)] group-hover:scale-105" />
              </Link>
              {hero.slice(1).map((p, i) => (
                <Link key={p.id} href={`/products/${p.id}`} tabIndex={-1} className={`group aspect-square overflow-hidden rounded-[3px] ${i ? "bg-gold-soft" : "bg-sand"}`}>
                  <ProductImage src={p.imageUrl} alt={p.name} className="h-full w-full object-contain p-5 transition-transform duration-[1200ms] ease-[var(--ease-premium)] group-hover:scale-105" />
                </Link>
              ))}
              <div className="absolute -left-3 top-1/2 hidden h-28 w-px -translate-y-1/2 bg-gold sm:block" />
            </div>
          )}
        </Container>
      </section>

      {/* Values strip */}
      <section className="border-y border-line bg-paper">
        <Container className="grid gap-px py-7 text-center sm:grid-cols-3">
          {[["Curated", "Every piece is chosen, never filled in."], ["Honest pricing", "One clear price. No theatre."], ["Your account, secured", "Verified email and rotating sessions."]].map(([t, d]) => (
            <div key={t} className="px-4 py-3">
              <p className="eyebrow !text-gold">{t}</p>
              <p className="mt-2 text-sm text-ink-soft">{d}</p>
            </div>
          ))}
        </Container>
      </section>

      {/* Categories */}
      {tiles.length > 0 && (
        <section className="pt-28">
          <Container>
            <Heading eyebrow="Browse" title="Shop by category" />
            <div className="mt-12 grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-4">
              {tiles.map(({ category, image, total }, i) => (
                <Link key={category.id} href={`/products?categoryId=${category.id}`} className="group relative block aspect-[3/4] overflow-hidden rounded-[3px] bg-sand">
                  <ProductImage src={image} alt={category.name} className="h-full w-full object-contain p-10 transition-transform duration-[1200ms] ease-[var(--ease-premium)] group-hover:scale-105" />
                  <div className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-sand via-sand/80 to-transparent p-5 pt-16">
                    <div>
                      <p className="eyebrow">{String(i + 1).padStart(2, "0")} · {total} {total === 1 ? "piece" : "pieces"}</p>
                      <h3 className="mt-1.5 font-serif text-2xl capitalize">{category.name}</h3>
                    </div>
                    <span className="grid h-9 w-9 place-items-center rounded-full border border-ink/20 transition-all duration-500 group-hover:border-ink group-hover:bg-ink group-hover:text-ivory">
                      <ArrowUpRight size={16} />
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </Container>
        </section>
      )}

      {/* New arrivals */}
      <section className="pt-28">
        <Container>
          <div className="flex items-end justify-between gap-6">
            <Heading eyebrow="Just in" title="New arrivals" />
            <Link href="/products?sort=newest" className="group hidden items-center gap-2 pb-1 text-sm tracking-wide text-ink-soft transition-colors hover:text-ink sm:flex">
              View all <ArrowRight size={15} className="transition-transform duration-300 group-hover:translate-x-1" />
            </Link>
          </div>
          {products.length ? (
            <div className={`mt-12 ${gridClass}`}>
              {products.map((p, i) => (
                <div key={p.id} className="reveal" style={{ animationDelay: `${i * 60}ms` }}>
                  <ProductCard p={p} />
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-12 rounded-[3px] border border-dashed border-line p-12 text-center text-sm text-mute">
              The collection is being prepared. If you run the catalog, sign in as admin and import the sample products.
            </p>
          )}
        </Container>
      </section>

      {/* Editorial */}
      <section className="mt-28 bg-ink text-ivory">
        <Container className="grid items-center gap-10 py-24 lg:grid-cols-[1fr_1.2fr]">
          <p className="eyebrow !text-gold">Our standard</p>
          <blockquote className="font-serif text-[clamp(1.75rem,3.6vw,3rem)] font-light leading-[1.18]">
            “Buy less, choose well, and make it last.” <span className="mt-6 block text-base font-normal not-italic tracking-wide text-ivory/50">— the principle behind every piece we list</span>
          </blockquote>
        </Container>
      </section>
    </>
  );
}

function Heading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div>
      <p className="eyebrow flex items-center gap-4">
        <span className="h-px w-8 bg-gold" /> {eyebrow}
      </p>
      <h2 className="mt-4 font-serif text-4xl font-light tracking-tight sm:text-5xl">{title}</h2>
    </div>
  );
}
