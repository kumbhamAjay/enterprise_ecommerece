import { Check } from "lucide-react";
import type { OrderStatus } from "@/lib/types";

const STEPS = [["Placed", "PENDING_PAYMENT"], ["Paid", "PAID"], ["Preparing", "PROCESSING"], ["Shipped", "SHIPPED"], ["Delivered", "DELIVERED"]] as const;
const INDEX: Record<string, number> = { PENDING_PAYMENT: 0, PAID: 1, PROCESSING: 2, SHIPPED: 3, DELIVERED: 4 };

// Order tracking: a progress line for the happy path; cancelled/refunded orders show a plain state instead.
export function OrderTracker({ status }: { status: OrderStatus }) {
  if (status === "CANCELLED" || status === "REFUNDED")
    return <p className="rounded-[3px] border border-line bg-paper px-5 py-4 text-sm text-ink-soft">{status === "CANCELLED" ? "This order was cancelled. Nothing was charged." : "This order was refunded."}</p>;
  const at = INDEX[status];
  return (
    <ol className="flex items-start" aria-label="Order progress">
      {STEPS.map(([label], i) => (
        <li key={label} className="relative flex flex-1 flex-col items-center text-center" aria-current={i === at ? "step" : undefined}>
          {i > 0 && <span className={`absolute right-1/2 top-[13px] h-px w-full ${i <= at ? "bg-gold" : "bg-line"}`} />}
          <span className={`relative z-10 grid h-7 w-7 place-items-center rounded-full border text-xs transition-colors ${i < at ? "border-gold bg-gold text-white" : i === at ? "border-ink bg-ink text-ivory" : "border-line bg-paper text-mute"}`}>
            {i < at ? <Check size={14} /> : i + 1}
          </span>
          <span className={`mt-2.5 text-[0.6875rem] tracking-wide ${i <= at ? "text-ink" : "text-mute"}`}>{label}</span>
        </li>
      ))}
    </ol>
  );
}
