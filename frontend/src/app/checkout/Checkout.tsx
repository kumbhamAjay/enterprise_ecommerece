"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Lock } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useCart } from "@/lib/cart";
import { money } from "@/lib/format";
import { useRequireAuth } from "@/lib/guards";
import { useAddresses, useCheckoutPreview } from "@/lib/hooks";
import { useToast } from "@/lib/toast";
import type { Order, OrderAddress } from "@/lib/types";
import { ProductImage } from "@/components/product/ProductCard";
import { Button } from "@/components/ui/Button";
import { Container, FieldErrorSummary, Skeleton } from "@/components/ui/Misc";
import { AddressFields, clean, emptyAddress } from "./AddressFields";

export function Checkout() {
  const { allowed, user } = useRequireAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const { view, loading: cartLoading } = useCart();
  const { data: preview } = useCheckoutPreview(allowed);
  const { data: saved } = useAddresses(allowed);

  const [ship, setShip] = useState<OrderAddress>(emptyAddress);
  const [bill, setBill] = useState<OrderAddress>(emptyAddress);
  const [same, setSame] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const placed = useRef(false);

  // prefill the name, and the default saved address once
  const prefilled = useRef(false);
  useEffect(() => {
    if (!user || !saved || prefilled.current) return;
    prefilled.current = true;
    const d = saved.find((a) => a.isDefault) ?? saved[0];
    setShip((s) => ({ ...s, fullName: `${user.firstName} ${user.lastName ?? ""}`.trim(), ...(d && { line1: d.addressLine1, city: d.city, state: d.state ?? "", postalCode: d.postalCode ?? "", country: d.country }) }));
  }, [user, saved]);

  // an empty bag has nothing to check out (but don't bounce away right after placing the order)
  useEffect(() => {
    if (allowed && !cartLoading && view.items.length === 0 && !placed.current) router.replace("/cart");
  }, [allowed, cartLoading, view.items.length, router]);

  // One idempotency key per distinct request: retrying the same attempt reuses it (the server returns the same order,
  // never a second one); changing the address is a different request, so it gets a fresh key.
  const attempt = useRef<{ sig: string; key: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const s = clean(ship);
    const local: Record<string, string> = {};
    if (!s.fullName) local.fullName = "Required";
    if (!s.line1) local.line1 = "Required";
    if (!s.city) local.city = "Required";
    if (!s.country) local.country = "Required";
    const b = same ? undefined : clean(bill);
    if (b && (!b.fullName || !b.line1 || !b.city || !b.country)) local.billing = "Complete the billing address";
    setErrors(local);
    setError(local.billing ?? "");
    if (Object.keys(local).length) return;

    const body = { shippingAddress: s, ...(b && { billingAddress: b }) };
    const sig = JSON.stringify(body);
    if (attempt.current?.sig !== sig) attempt.current = { sig, key: crypto.randomUUID() };

    setBusy(true);
    try {
      const order = await api.post<Order>("/api/checkout", body, true, { "Idempotency-Key": attempt.current.key });
      placed.current = true;
      qc.setQueryData(["cart"], { items: [], itemCount: 0, subtotal: "0.00", currency: "USD", hasIssues: false });
      qc.invalidateQueries({ queryKey: ["orders"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      router.push(`/orders/${order.id}?placed=1`);
    } catch (err) {
      if (err instanceof ApiError) {
        const f: Record<string, string> = {};
        for (const [k, v] of Object.entries(err.fields)) f[k.replace("shippingAddress.", "")] = v;
        setErrors(f);
        setError(err.status === 409 ? `${err.message}. Please review your bag.` : Object.keys(f).length ? "" : err.message);
        if (err.status === 409) { qc.invalidateQueries({ queryKey: ["cart"] }); qc.invalidateQueries({ queryKey: ["checkout"] }); }
      } else toast.error("Network error. Please try again — you won’t be charged twice.");
      setBusy(false);
    }
  }

  if (!allowed || cartLoading)
    return <Container className="py-16"><Skeleton className="h-12 w-64" /><Skeleton className="mt-10 h-96" /></Container>;

  const p = preview;
  return (
    <Container className="py-10 lg:py-14">
      <Link href="/cart" className="inline-flex items-center gap-2 text-sm text-mute transition-colors hover:text-ink"><ArrowLeft size={15} /> Back to bag</Link>
      <div className="reveal mt-6">
        <p className="eyebrow flex items-center gap-4"><span className="h-px w-8 bg-gold" /> Secure checkout</p>
        <h1 className="mt-4 font-serif text-5xl font-light tracking-tight">Checkout</h1>
      </div>

      <form onSubmit={submit} noValidate className="mt-12 grid gap-14 lg:grid-cols-[1fr_400px] lg:gap-20">
        <div className="space-y-12">
          <FieldErrorSummary message={error} />
          <section>
            <h2 className="font-serif text-2xl">Shipping address</h2>
            {saved && saved.length > 0 && (
              <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label="Saved addresses">
                {saved.map((a) => (
                  <button type="button" key={a.id} onClick={() => setShip((s) => ({ ...s, line1: a.addressLine1, city: a.city, state: a.state ?? "", postalCode: a.postalCode ?? "", country: a.country }))} className="rounded-full border border-line bg-paper px-4 py-2 text-xs transition-colors hover:border-ink">
                    {a.addressLine1}, {a.city}
                  </button>
                ))}
              </div>
            )}
            <div className="mt-6"><AddressFields value={ship} onChange={setShip} errors={errors} /></div>
          </section>

          <section>
            <h2 className="font-serif text-2xl">Billing address</h2>
            <label className="mt-5 flex cursor-pointer items-center gap-3 text-sm text-ink-soft">
              <input type="checkbox" checked={same} onChange={(e) => setSame(e.target.checked)} className="h-4 w-4 accent-[var(--color-gold)]" />
              Same as shipping address
            </label>
            {!same && <div className="mt-6"><AddressFields value={bill} onChange={setBill} /></div>}
          </section>
        </div>

        <aside className="h-fit rounded-[3px] border border-line bg-paper p-7 lg:sticky lg:top-28">
          <h2 className="font-serif text-2xl">Your order</h2>
          <ul className="mt-6 space-y-5">
            {view.items.map((i) => (
              <li key={i.productId} className="flex gap-4">
                <div className="relative h-20 w-16 shrink-0 overflow-hidden rounded-[3px] bg-sand">
                  <ProductImage w={160} src={i.imageUrl} alt={i.name} className="h-full w-full object-contain p-1.5" />
                  <span className="absolute -right-0 top-0 grid h-5 min-w-5 place-items-center rounded-bl bg-ink px-1 text-[0.625rem] text-ivory">{i.quantity}</span>
                </div>
                <div className="flex min-w-0 flex-1 justify-between gap-3 text-sm">
                  <span className="line-clamp-2 font-serif">{i.name}</span>
                  <span className="tabular-nums">{money(i.lineTotal)}</span>
                </div>
              </li>
            ))}
          </ul>
          <div className="my-6 h-px bg-line" />
          {p ? (
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between"><dt className="text-ink-soft">Subtotal</dt><dd className="tabular-nums">{money(p.subtotal)}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-soft">Shipping</dt><dd className="tabular-nums">{Number(p.shipping) === 0 ? "Free" : money(p.shipping)}</dd></div>
              {Number(p.amountToFreeShipping) > 0 && <p className="text-xs text-gold">Add {money(p.amountToFreeShipping)} more for free shipping.</p>}
              <div className="flex items-baseline justify-between border-t border-line pt-4"><dt className="font-serif text-xl">Total</dt><dd className="font-serif text-2xl tabular-nums">{money(p.total)}</dd></div>
            </dl>
          ) : <Skeleton className="h-28" />}
          <Button type="submit" size="lg" loading={busy} disabled={!p || p.hasIssues} className="mt-7 w-full"><Lock size={15} /> Place order</Button>
          <p className="mt-4 text-center text-xs leading-relaxed text-mute">Your items are held for 30 minutes while you pay. Pressing the button twice never creates two orders.</p>
        </aside>
      </form>
    </Container>
  );
}
