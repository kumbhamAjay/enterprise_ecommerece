"use client";
import { useAuth } from "@/lib/auth";
import { useCart } from "@/lib/cart";
import { money } from "@/lib/format";
import { LinkButton } from "../ui/Button";

export function CartSummary({ extra }: { extra?: React.ReactNode }) {
  const { view, setOpen } = useCart();
  const { status } = useAuth();
  const empty = view.items.length === 0;
  const blocked = empty || view.hasIssues;
  return (
    <div>
      <dl className="space-y-3 text-sm">
        <div className="flex justify-between"><dt className="text-ink-soft">Subtotal ({view.itemCount} {view.itemCount === 1 ? "item" : "items"})</dt><dd className="tabular-nums">{money(view.subtotal)}</dd></div>
        <div className="flex justify-between text-mute"><dt>Shipping &amp; taxes</dt><dd>At checkout</dd></div>
      </dl>
      <div className="my-5 h-px bg-line" />
      <div className="flex items-baseline justify-between"><span className="font-serif text-xl">Total</span><span className="font-serif text-2xl tabular-nums">{money(view.subtotal)}</span></div>
      {view.hasIssues && <p className="mt-4 text-xs leading-relaxed text-danger">Some items need your attention before you can check out.</p>}
      {blocked ? (
        <span aria-disabled className="mt-6 inline-flex h-13 w-full cursor-not-allowed items-center justify-center rounded-[3px] bg-ink/40 text-sm font-medium tracking-wide text-ivory">Checkout</span>
      ) : (
        <LinkButton href={status === "authed" ? "/checkout" : "/login?next=/checkout"} onClick={() => setOpen(false)} size="lg" className="mt-6 w-full">{status === "authed" ? "Checkout" : "Sign in to check out"}</LinkButton>
      )}
      <p className="mt-3 text-center text-xs leading-relaxed text-mute">{view.hasIssues ? "Fix the highlighted items to continue." : "Shipping is free from $100."}</p>
      {extra}
    </div>
  );
}
