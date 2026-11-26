"use client";
import { useCart } from "@/lib/cart";
import { CartLines } from "@/components/cart/CartLines";
import { CartSummary } from "@/components/cart/CartSummary";
import { LinkButton, Button } from "@/components/ui/Button";
import { Container, EmptyState } from "@/components/ui/Misc";

export default function CartPage() {
  const { view, loading, clear, busy } = useCart();
  return (
    <Container className="py-12 lg:py-16">
      <div className="reveal">
        <p className="eyebrow flex items-center gap-4"><span className="h-px w-8 bg-gold" /> Your selection</p>
        <h1 className="mt-4 font-serif text-5xl font-light tracking-tight">Shopping bag</h1>
      </div>
      {!loading && view.items.length === 0 ? (
        <EmptyState title="Your bag is empty" text="Pieces you add will wait here, even if you come back later." action={<LinkButton href="/products">Explore the collection</LinkButton>} />
      ) : (
        <div className="mt-12 grid gap-14 lg:grid-cols-[1fr_380px] lg:gap-20">
          <div>
            <CartLines />
            <Button variant="ghost" size="sm" className="mt-6" onClick={clear} disabled={busy}>Empty bag</Button>
          </div>
          <aside className="h-fit rounded-[3px] border border-line bg-paper p-7 lg:sticky lg:top-28"><CartSummary /></aside>
        </div>
      )}
    </Container>
  );
}
