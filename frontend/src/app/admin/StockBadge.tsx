import { Badge } from "@/components/ui/Misc";
import type { StockStatus } from "@/lib/types";

export function StockBadge({ status, left }: { status: StockStatus; left?: number | null }) {
  if (status === "OUT_OF_STOCK") return <Badge tone="danger">Sold out</Badge>;
  if (status === "LOW_STOCK") return <Badge tone="gold">Low{left != null ? ` · ${left}` : ""}</Badge>;
  return <Badge tone="ok">In stock</Badge>;
}
