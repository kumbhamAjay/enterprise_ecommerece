"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Misc";
import { OrderTracker } from "@/components/orders/OrderTracker";
import { STATUS_LABEL, StatusBadge } from "@/components/orders/StatusBadge";
import { api, ApiError } from "@/lib/api";
import { money } from "@/lib/format";
import { useOrder } from "@/lib/hooks";
import { useToast } from "@/lib/toast";
import type { Order, OrderStatus } from "@/lib/types";

// What an admin may do next (mirrors the server's state machine; the server is the one that enforces it).
const NEXT: Partial<Record<OrderStatus, { to: OrderStatus; label: string; tone?: "danger" }[]>> = {
  PENDING_PAYMENT: [{ to: "PAID", label: "Mark as paid (manual)" }, { to: "CANCELLED", label: "Cancel order", tone: "danger" }],
  PAID: [{ to: "PROCESSING", label: "Start preparing" }, { to: "REFUNDED", label: "Refund", tone: "danger" }],
  PROCESSING: [{ to: "SHIPPED", label: "Mark as shipped" }, { to: "REFUNDED", label: "Refund", tone: "danger" }],
  SHIPPED: [{ to: "DELIVERED", label: "Mark as delivered" }, { to: "REFUNDED", label: "Refund", tone: "danger" }],
  DELIVERED: [{ to: "REFUNDED", label: "Refund", tone: "danger" }],
};
const when = (d: string) => new Date(d).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

export function OrderPanel({ orderId, onClose }: { orderId: string | null; onClose: () => void }) {
  const { data: o, isPending } = useOrder(orderId);
  const qc = useQueryClient();
  const toast = useToast();
  const [note, setNote] = useState("");

  const move = useMutation({
    mutationFn: (to: OrderStatus) => api.post<Order>(`/api/admin/orders/${orderId}/status`, { status: to, note: note.trim() || undefined }),
    onSuccess: (updated) => {
      qc.setQueryData(["orders", "one", orderId], updated);
      ["orders", "products", "inventory"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      setNote("");
      toast.success(`Order is now ${STATUS_LABEL[updated.status].toLowerCase()}.`);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not update the order."),
  });

  return (
    <Modal open={!!orderId} onClose={onClose} title="Order" side="right" wide>
      {isPending || !o ? (
        <div className="space-y-4"><Skeleton className="h-8 w-2/3" /><Skeleton className="h-24" /><Skeleton className="h-48" /></div>
      ) : (
        <div className="space-y-9">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="font-mono text-xl">{o.orderNumber}</h3>
              <p className="mt-1 text-sm text-mute">{o.customerEmail} · {when(o.placedAt)}</p>
            </div>
            <StatusBadge status={o.status} />
          </div>

          <OrderTracker status={o.status} />

          {NEXT[o.status] && (
            <div className="space-y-4 rounded-[3px] border border-line bg-paper p-5">
              <h4 className="eyebrow !text-ink">Next step</h4>
              <Input label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Visible in the order history" />
              <div className="flex flex-wrap gap-3">
                {NEXT[o.status]!.map((a) => (
                  <Button key={a.to} variant={a.tone === "danger" ? "danger" : "primary"} size="sm" loading={move.isPending && move.variables === a.to} disabled={move.isPending} onClick={() => move.mutate(a.to)}>{a.label}</Button>
                ))}
              </div>
              {o.status === "PENDING_PAYMENT" && <p className="text-xs leading-relaxed text-mute">Card payments confirm automatically. Use this only for an off-site payment (e.g. bank transfer); it sells the held stock.</p>}
            </div>
          )}

          <div>
            <h4 className="eyebrow !text-ink">Payment</h4>
            {o.payments.length === 0 ? (
              <p className="mt-3 text-sm text-mute">No card payment started.</p>
            ) : (
              <ul className="mt-3 divide-y divide-line border-y border-line text-sm">
                {o.payments.map((p, i) => (
                  <li key={i} className="py-3">
                    <div className="flex justify-between gap-4"><span>{p.status === "SUCCEEDED" ? (p.appliedToOrder ? "Paid by card" : "Paid, not applied to the order") : p.status === "FAILED" ? "Card declined" : p.status === "CANCELED" ? "Cancelled" : "Waiting for payment"}</span><span className="tabular-nums">{money(p.amountCents / 100)}</span></div>
                    {p.lastError && <p className="mt-1 text-xs text-danger">{p.lastError}</p>}
                    {p.refunds.map((r, j) => <p key={j} className="mt-1 text-xs text-mute">Refund {money(r.amountCents / 100)} · {r.reason === "LATE_PAYMENT" ? "paid after the order lapsed" : "order refund"} · {r.status.toLowerCase()}</p>)}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h4 className="eyebrow !text-ink">Items</h4>
            <ul className="mt-3 divide-y divide-line border-y border-line text-sm">
              {o.items.map((i, n) => (
                <li key={n} className="flex justify-between gap-4 py-3"><span>{i.name} <span className="text-mute">× {i.quantity}</span></span><span className="tabular-nums">{money(i.lineTotal)}</span></li>
              ))}
              <li className="flex justify-between py-3 text-mute"><span>Shipping</span><span className="tabular-nums">{Number(o.shipping) === 0 ? "Free" : money(o.shipping)}</span></li>
              <li className="flex justify-between py-3 font-medium"><span>Total</span><span className="tabular-nums">{money(o.total)}</span></li>
            </ul>
          </div>

          <div className="grid gap-6 text-sm sm:grid-cols-2">
            {([["Ship to", o.shippingAddress], ["Bill to", o.billingAddress]] as const).map(([t, a]) => (
              <div key={t}>
                <h4 className="eyebrow !text-ink">{t}</h4>
                <address className="mt-3 not-italic leading-relaxed text-ink-soft">{a.fullName}<br />{a.line1}{a.line2 && `, ${a.line2}`}<br />{[a.city, a.state, a.postalCode].filter(Boolean).join(", ")}<br />{a.country}</address>
              </div>
            ))}
          </div>

          <div>
            <h4 className="eyebrow !text-ink">History</h4>
            <ol className="mt-4 space-y-4 border-l border-line pl-5">
              {[...o.history].reverse().map((h, i) => (
                <li key={i} className="relative text-sm">
                  <span className="absolute -left-[25px] top-1.5 h-2 w-2 rounded-full bg-gold" />
                  {STATUS_LABEL[h.toStatus]}{h.note && <span className="text-mute"> · {h.note}</span>}
                  <p className="mt-0.5 text-xs text-mute">{when(h.createdAt)} · {h.actor ?? "System"}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </Modal>
  );
}
