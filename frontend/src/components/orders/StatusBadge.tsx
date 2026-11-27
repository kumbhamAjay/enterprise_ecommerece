import { Badge } from "../ui/Misc";
import type { OrderStatus } from "@/lib/types";

export const STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING_PAYMENT: "Awaiting payment", PAID: "Paid", PROCESSING: "Being prepared", SHIPPED: "Shipped", DELIVERED: "Delivered", CANCELLED: "Cancelled", REFUNDED: "Refunded",
};
const TONE: Record<OrderStatus, "neutral" | "gold" | "ok" | "danger"> = {
  PENDING_PAYMENT: "gold", PAID: "ok", PROCESSING: "neutral", SHIPPED: "neutral", DELIVERED: "ok", CANCELLED: "danger", REFUNDED: "danger",
};
export const StatusBadge = ({ status }: { status: OrderStatus }) => <Badge tone={TONE[status]}>{STATUS_LABEL[status]}</Badge>;
