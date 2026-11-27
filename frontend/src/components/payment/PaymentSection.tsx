"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { CheckCircle2, Lock } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { money } from "@/lib/format";
import type { Order } from "@/lib/types";
import { Button } from "../ui/Button";
import { Skeleton } from "../ui/Misc";

type Intent = { clientSecret: string; publishableKey: string | null; amountCents: number; currency: string };

// The card form is rendered by Stripe inside an iframe: card numbers go from the browser straight to Stripe and never touch our server.
const appearance = {
  theme: "flat" as const,
  variables: { colorPrimary: "#14110f", colorBackground: "#ffffff", colorText: "#14110f", colorDanger: "#b3261e", fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif", borderRadius: "3px", spacingUnit: "4px" },
  rules: { ".Input": { border: "1px solid #e7e1d8", boxShadow: "none", padding: "14px" }, ".Input:focus": { border: "1px solid #14110f", boxShadow: "none" }, ".Label": { fontSize: "11px", letterSpacing: "0.18em", textTransform: "uppercase" as const, color: "#4b4540" } },
};

const stripeCache = new Map<string, ReturnType<typeof loadStripe>>();
const stripeFor = (key: string) => stripeCache.get(key) ?? stripeCache.set(key, loadStripe(key)).get(key)!;

export function PaymentSection({ order }: { order: Order }) {
  const qc = useQueryClient();
  // Server-side the intent is idempotent: reopening the page or a double effect returns the same PaymentIntent.
  const { data: intent, error, isPending } = useQuery({
    queryKey: ["payment-intent", order.id],
    queryFn: () => api.post<Intent>(`/api/payments/orders/${order.id}/intent`),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });
  const [settling, setSettling] = useState(false);

  const settle = async () => {
    setSettling(true);
    try {
      // The browser says "paid". The server doesn't take its word for it: it asks Stripe (the webhook usually got there first).
      const updated = await api.post<Order>(`/api/payments/orders/${order.id}/sync`);
      qc.setQueryData(["orders", "one", order.id], updated);
      ["orders", "products", "inventory"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    } finally {
      setSettling(false);
    }
  };

  // Coming back from a redirect-based method (3-D Secure etc.) lands here with ?paid=1
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current || new URLSearchParams(location.search).get("paid") !== "1") return;
    ran.current = true;
    void settle();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (isPending) return <Skeleton className="h-64" />;
  if (error || !intent)
    return <p className="rounded-[3px] border border-danger/30 bg-[#fbeeed] px-5 py-4 text-sm text-danger">{error instanceof ApiError && error.status === 503 ? "Card payments aren’t available yet." : error instanceof ApiError ? error.message : "We couldn’t start the payment. Please refresh."}</p>;
  if (!intent.publishableKey)
    return <p className="rounded-[3px] border border-line bg-paper px-5 py-4 text-sm text-ink-soft">Card payments aren’t configured on this server yet.</p>;

  return (
    <Elements stripe={stripeFor(intent.publishableKey)} options={{ clientSecret: intent.clientSecret, appearance, fonts: [{ cssSrc: "https://fonts.googleapis.com/css2?family=Geist:wght@400;500&display=swap" }] }}>
      <PayForm orderId={order.id} total={money(order.total)} settling={settling} onPaid={settle} />
    </Elements>
  );
}

function PayForm({ orderId, total, settling, onPaid }: { orderId: string; total: string; settling: boolean; onPaid: () => Promise<void> }) {
  const stripe = useStripe();
  const elements = useElements();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [ready, setReady] = useState(false); // Stripe's card form has mounted
  const [loadFailed, setLoadFailed] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    setMessage("");
    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: "if_required", // cards finish inline; redirect only when the bank demands it
      confirmParams: { return_url: `${location.origin}/orders/${orderId}?paid=1` },
    });
    if (error) {
      setMessage(error.message ?? "Your payment didn’t go through. Please try another card.");
      setBusy(false);
      return;
    }
    if (paymentIntent && (paymentIntent.status === "succeeded" || paymentIntent.status === "processing")) {
      setDone(true);
      await onPaid().catch(() => setMessage("Payment received. It may take a moment to show up here."));
    }
    setBusy(false);
  }

  if (done)
    return (
      <div className="flex items-start gap-4 rounded-[3px] border border-ok/30 bg-[#e8f2ec] p-6">
        <CheckCircle2 className="mt-0.5 shrink-0 text-ok" size={24} />
        <div><p className="font-serif text-2xl">Payment received</p><p className="mt-1 text-sm text-ink-soft">{settling ? "Confirming your order…" : "Thank you. Your order is confirmed."}</p>{message && <p className="mt-2 text-xs text-mute">{message}</p>}</div>
      </div>
    );

  return (
    <form onSubmit={submit} className="rounded-[3px] border border-line bg-paper p-6 sm:p-8">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="font-serif text-2xl">Payment</h2>
        <span className="inline-flex items-center gap-2 text-xs text-mute"><Lock size={13} /> Secured by Stripe</span>
      </div>
      <PaymentElement
        options={{ layout: "tabs" }}
        onReady={() => setReady(true)}
        onLoadError={(e) => { console.error("Stripe Payment Element failed to load:", e.error); setLoadFailed(true); }}
      />
      {!ready && !loadFailed && <div className="skeleton h-40 rounded-[3px]" aria-hidden />}
      {loadFailed && <p role="alert" className="rounded-[3px] border border-danger/30 bg-[#fbeeed] px-4 py-3 text-sm text-danger">We couldn’t load the secure card form. Please refresh the page. If this keeps happening, the payment setup needs attention.</p>}
      {message && <p role="alert" className="mt-4 text-sm text-danger">{message}</p>}
      <Button type="submit" size="lg" loading={busy} disabled={!stripe || !elements || !ready || loadFailed} className="mt-7 w-full"><Lock size={15} /> Pay {total}</Button>
      <p className="mt-4 text-center text-xs leading-relaxed text-mute">Your card details go directly to Stripe and are never stored on our servers.</p>
    </form>
  );
}
