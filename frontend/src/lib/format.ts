const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export const money = (v: string | number) => usd.format(Number(v));
export const initials = (first: string, last?: string | null) => `${first[0] ?? ""}${last?.[0] ?? ""}`.toUpperCase();

export function qs(params: Record<string, string | number | undefined | null>) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") s.set(k, String(v));
  return s.toString();
}
