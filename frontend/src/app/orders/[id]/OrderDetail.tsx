"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Clock } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { money } from "@/lib/format";
import { useRequireAuth } from "@/lib/guards";
import { useOrder } from "@/lib/hooks";
import { useToast } from "@/lib/toast";
import type { Order, OrderAddress } from "@/lib/types";
import { PaymentSection } from "@/components/payment/PaymentSection";
import { OrderTracker } from "@/components/orders/OrderTracker";
import { STATUS_LABEL, StatusBadge } from "@/components/orders/StatusBadge";
import { ProductImage } from "@/components/product/ProductCard";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Container, EmptyState, Skeleton } from "@/components/ui/Misc";

const when = (d: string) => new Date(d).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

function useMinutesLeft(deadline: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(t);
  }, []);
  return deadline ? Math.ceil((new Date(deadline).getTime() - now) / 60_000) : null;
}

const Address = ({ title, a }: { title: string; a: OrderAddress }) => (
  <div>
    <p className="eyebrow">{title}</p>
    <address className="mt-3 text-sm not-italic leading-relaxed text-ink-soft">
      <span className="text-ink">{a.fullName}</span><br />
      {a.line1}{a.line2 && <>, {a.line2}</>}<br />
      {[a.city, a.state, a.postalCode].filter(Boolean).join(", ")}<br />
      {a.country}{a.phone && <><br />{a.phone}</>}
    </address>
  </div>
);

export function OrderDetail() {
  const { allowed } = useRequireAuth();
  const id = useParams<{ id: string }>().id;
  const placed = useSearchParams().get("placed") === "1";
  const { data: o, isPending, error } = useOrder(allowed ? id : null);
  const qc = useQueryClient();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const minutes = useMinutesLeft(o?.status === "PENDING_PAYMENT" ? o.paymentExpiresAt : null);

  const cancel = useMutation({
    mutationFn: () => api.post<Order>(`/api/orders/${id}/cancel`, {}),
    onSuccess: (updated) => {
      qc.setQueryData(["orders", "one", id], updated);
      ["orders", "products", "inventory"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      setConfirm(false);
      toast.success(updated.status === "REFUNDED" ? "Order cancelled. Your refund is on its way." : "Order cancelled.");
    },
    onError: (e) => { setConfirm(false); toast.error(e instanceof ApiError ? e.message : "Could not cancel the order."); },
  });

  if (!allowed || isPending)
    return <Container className="py-16"><Skeleton className="h-12 w-72" /><Skeleton className="mt-10 h-80" /></Container>;
  if (error || !o)
    return <Container><EmptyState title="Order not found" text="We couldn’t find that order on your account." action={<Link href="/orders" className="text-sm underline decoration-gold underline-offset-4">Back to your orders</Link>} /></Container>;

  const canCancel = o.status === "PENDING_PAYMENT" || o.status === "PAID";
  return (
    <Container className="py-10 lg:py-14">
      <Link href="/orders" className="inline-flex items-center gap-2 text-sm text-mute transition-colors hover:text-ink"><ArrowLeft size={15} /> All orders</Link>

      {placed && (
        <div className="reveal mt-6 flex items-start gap-4 rounded-[3px] border border-ok/30 bg-[#e8f2ec] p-6">
          <CheckCircle2 className="mt-0.5 shrink-0 text-ok" size={24} />
          <div>
            <p className="font-serif text-2xl">Thank you — your order is placed.</p>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">We’re holding your items. A confirmation will go to <strong>{o.customerEmail}</strong>.</p>
          </div>
        </div>
      )}

      <div className="mt-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Order</p>
          <h1 className="mt-2 font-mono text-3xl tracking-wide">{o.orderNumber}</h1>
          <p className="mt-2 text-sm text-mute">Placed {when(o.placedAt)}</p>
        </div>
        <StatusBadge status={o.status} />
      </div>

      <div className="mt-10 rounded-[3px] border border-line bg-paper px-6 py-8 sm:px-10"><OrderTracker status={o.status} /></div>

      {o.status === "PENDING_PAYMENT" && (
        <div className="mt-6 space-y-6">
          <div className="flex items-start gap-4 rounded-[3px] border border-gold/30 bg-gold-soft/50 p-5">
            <Clock className="mt-0.5 shrink-0 text-gold" size={20} />
            <div className="text-sm leading-relaxed text-[#6d5126]">
              <p className="font-medium">{minutes !== null && minutes > 0 ? `Your items are held for ${minutes} more minute${minutes === 1 ? "" : "s"}.` : "The hold on your items is ending."}</p>
              <p className="mt-1">Complete your payment to confirm the order. Unpaid orders are released automatically.</p>
            </div>
          </div>
          {minutes === null || minutes > 0 ? <div className="max-w-2xl"><PaymentSection order={o} /></div> : null}
        </div>
      )}

      {o.payments.some((p) => p.status === "SUCCEEDED" && p.appliedToOrder) && (
        <p className="mt-6 flex items-center gap-2 text-sm text-ok"><CheckCircle2 size={16} /> Paid by card{o.payments[0].refundedCents > 0 && ` · ${money(o.payments[0].refundedCents / 100)} refunded`}</p>
      )}
      {o.payments.flatMap((p) => p.refunds).some((r) => r.status === "PENDING") && (
        <p className="mt-3 text-sm text-ink-soft">Your refund is being processed. It can take a few days to appear on your statement.</p>
      )}

      <div className="mt-12 grid gap-12 lg:grid-cols-[1fr_380px] lg:gap-16">
        <div className="space-y-12">
          <section>
            <h2 className="font-serif text-2xl">Items</h2>
            <ul className="mt-5 divide-y divide-line border-y border-line">
              {o.items.map((i, n) => (
                <li key={n} className="flex gap-4 py-5">
                  <div className="h-24 w-20 shrink-0 overflow-hidden rounded-[3px] bg-sand"><ProductImage w={240} src={i.imageUrl} alt={i.name} className="h-full w-full object-contain p-2" /></div>
                  <div className="flex min-w-0 flex-1 justify-between gap-4">
                    <div className="min-w-0">
                      {i.productId ? <Link href={`/products/${i.productId}`} className="font-serif text-lg hover:text-gold">{i.name}</Link> : <span className="font-serif text-lg">{i.name}</span>}
                      <p className="mt-1 text-sm text-mute">{money(i.unitPrice)} × {i.quantity}</p>
                    </div>
                    <p className="text-sm tabular-nums">{money(i.lineTotal)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="font-serif text-2xl">History</h2>
            <ol className="mt-6 space-y-5 border-l border-line pl-6">
              {[...o.history].reverse().map((h, i) => (
                <li key={i} className="relative">
                  <span className="absolute -left-[29px] top-1.5 h-2 w-2 rounded-full bg-gold" />
                  <p className="text-sm">{STATUS_LABEL[h.toStatus]}{h.note && <span className="text-mute"> · {h.note}</span>}</p>
                  <p className="mt-0.5 text-xs text-mute">{when(h.createdAt)}</p>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className="space-y-10">
          <div className="rounded-[3px] border border-line bg-paper p-7">
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between"><dt className="text-ink-soft">Subtotal</dt><dd className="tabular-nums">{money(o.subtotal)}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-soft">Shipping</dt><dd className="tabular-nums">{Number(o.shipping) === 0 ? "Free" : money(o.shipping)}</dd></div>
              <div className="flex items-baseline justify-between border-t border-line pt-4"><dt className="font-serif text-xl">Total</dt><dd className="font-serif text-2xl tabular-nums">{money(o.total)}</dd></div>
            </dl>
          </div>
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-1">
            <Address title="Shipping to" a={o.shippingAddress} />
            <Address title="Billing address" a={o.billingAddress} />
          </div>
          {canCancel && (
            <Button variant="outline" className="w-full" onClick={() => setConfirm(true)}>{o.status === "PAID" ? "Cancel and refund" : "Cancel order"}</Button>
          )}
          {o.cancelReason && <p className="text-xs text-mute">Reason: {o.cancelReason}</p>}
        </aside>
      </div>

      <ConfirmDialog open={confirm} title={o.status === "PAID" ? "Cancel and refund this order?" : "Cancel this order?"} message={o.status === "PAID" ? "Your payment will be refunded and the items returned to stock. This can’t be undone." : "Your items will be released. This can’t be undone."} confirmLabel="Yes, cancel" loading={cancel.isPending} onConfirm={() => cancel.mutate()} onClose={() => setConfirm(false)} />
    </Container>
  );
}
