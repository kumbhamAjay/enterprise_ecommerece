"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "./api";
import { useAuth } from "./auth";
import { useToast } from "./toast";
import type { CartIssue, CartLine, CartView, ProductDetail, StockStatus } from "./types";

// Signed-in users: the cart lives on the server (/api/cart).
// Guests: lines live in localStorage and are merged into the server cart at login.
export const MAX_PER_LINE = 20;
const KEY = "shopeasy.cart";
type Line = { productId: string; quantity: number };
type StockHint = { stockStatus: StockStatus; stockLeft: number | null };

const readGuest = (): Line[] => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((l) => typeof l?.productId === "string" && Number.isInteger(l?.quantity) && l.quantity > 0).slice(0, 50) : [];
  } catch {
    return [];
  }
};
const writeGuest = (l: Line[]) => localStorage.setItem(KEY, JSON.stringify(l));

const cents = (v: string) => Math.round(Number(v) * 100); // money math in integer cents, never floats
const fmt = (c: number) => (c / 100).toFixed(2);

function buildGuestView(lines: Line[], results: { data?: ProductDetail; isPending: boolean }[]): { view: CartView; loading: boolean } {
  let loading = false;
  const items: CartLine[] = lines.map((l, i) => {
    const r = results[i];
    const p = r?.data;
    if (!p) {
      if (r?.isPending) loading = true;
      return { productId: l.productId, name: r?.isPending ? "Loading…" : "No longer available", sku: "", slug: "", imageUrl: null, unitPrice: "0.00", quantity: l.quantity, lineTotal: "0.00", isActive: !!r?.isPending, available: 0, issues: r?.isPending ? [] : ["UNAVAILABLE"] };
    }
    // The public API only reveals an exact count when stock is low; otherwise treat it as plentiful.
    const available = p.stockStatus === "OUT_OF_STOCK" ? 0 : p.stockStatus === "LOW_STOCK" ? p.stockLeft ?? 0 : 999;
    const issues: CartIssue[] = available <= 0 ? ["OUT_OF_STOCK"] : l.quantity > available ? ["INSUFFICIENT_STOCK"] : [];
    return { productId: p.id, name: p.name, sku: p.sku, slug: p.slug, imageUrl: p.images[0]?.url ?? null, unitPrice: p.price, quantity: l.quantity, lineTotal: fmt(cents(p.price) * l.quantity), isActive: true, available, issues };
  });
  const subtotal = items.filter((i) => i.isActive).reduce((s, i) => s + cents(i.lineTotal), 0);
  return { view: { items, itemCount: lines.reduce((s, l) => s + l.quantity, 0), subtotal: fmt(subtotal), currency: "USD", hasIssues: items.some((i) => i.issues.length > 0) }, loading };
}

const EMPTY: CartView = { items: [], itemCount: 0, subtotal: "0.00", currency: "USD", hasIssues: false };

type Ctx = {
  view: CartView;
  loading: boolean;
  busy: boolean;
  open: boolean;
  setOpen: (o: boolean) => void;
  add: (productId: string, quantity?: number, hint?: StockHint) => Promise<boolean>;
  setQty: (productId: string, quantity: number) => Promise<void>;
  remove: (productId: string) => Promise<void>;
  clear: () => Promise<void>;
};
const CartContext = createContext<Ctx | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const authed = status === "authed";
  const [guest, setGuest] = useState<Line[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // hydrate from localStorage after mount (SSR has no storage) and follow changes made in other tabs
  useEffect(() => {
    setGuest(readGuest());
    const onStorage = (e: StorageEvent) => e.key === KEY && setGuest(readGuest());
    addEventListener("storage", onStorage);
    return () => removeEventListener("storage", onStorage);
  }, []);
  const saveGuest = useCallback((next: Line[]) => { setGuest(next); writeGuest(next); }, []);

  const server = useQuery({ queryKey: ["cart"], queryFn: () => api.get<CartView>("/api/cart"), enabled: authed, staleTime: 15_000 });
  const guestResults = useQueries({
    queries: guest.map((l) => ({ queryKey: ["product", l.productId], queryFn: () => api.get<ProductDetail>(`/api/products/${l.productId}`), staleTime: 30_000, retry: false, enabled: !authed })),
  });
  const guestBuilt = buildGuestView(guest, guestResults);

  // Guest -> signed in: merge the browser bag into the account cart once.
  const merging = useRef(false);
  useEffect(() => {
    if (!authed || merging.current) return;
    const lines = readGuest();
    if (!lines.length) return;
    merging.current = true;
    api
      .post<{ cart: CartView; skipped: unknown[]; adjusted: unknown[] }>("/api/cart/merge", { items: lines })
      .then((r) => {
        qc.setQueryData(["cart"], r.cart);
        saveGuest([]);
        const trimmed = r.skipped.length + r.adjusted.length;
        toast.success(trimmed ? "Your bag was saved to your account. A few items changed because of availability." : "Your bag was saved to your account.");
      })
      .catch(() => {}) // keep the guest bag; the merge retries on the next sign-in
      .finally(() => { merging.current = false; });
  }, [authed, qc, saveGuest, toast]);

  useEffect(() => {
    if (status === "guest") qc.removeQueries({ queryKey: ["cart"] }); // signed out: forget the account cart
  }, [status, qc]);

  const fail = (e: unknown) => toast.error(e instanceof ApiError ? e.message : "Something went wrong. Please try again.");
  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    try { return await fn(); } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const apply = (cart: CartView) => qc.setQueryData(["cart"], cart);

  const add: Ctx["add"] = async (productId, quantity = 1, hint) => {
    if (authed) return !!(await run(async () => { apply(await api.post<CartView>("/api/cart/items", { productId, quantity })); return true; }));
    // guest: validate with what the product page already knows, then store locally
    const next = (guest.find((l) => l.productId === productId)?.quantity ?? 0) + quantity;
    if (hint?.stockStatus === "OUT_OF_STOCK") { toast.error("Sorry, this piece is sold out."); return false; }
    if (hint?.stockStatus === "LOW_STOCK" && hint.stockLeft != null && next > hint.stockLeft) { toast.error(`Only ${hint.stockLeft} available.`); return false; }
    if (next > MAX_PER_LINE) { toast.error(`Limit is ${MAX_PER_LINE} per item.`); return false; }
    saveGuest(guest.some((l) => l.productId === productId) ? guest.map((l) => (l.productId === productId ? { ...l, quantity: next } : l)) : [...guest, { productId, quantity: next }]);
    return true;
  };

  const setQty: Ctx["setQty"] = async (productId, quantity) => {
    if (authed) { await run(async () => apply(await api.patch<CartView>(`/api/cart/items/${productId}`, { quantity }))); return; }
    saveGuest(guest.map((l) => (l.productId === productId ? { ...l, quantity: Math.min(quantity, MAX_PER_LINE) } : l)));
  };
  const remove: Ctx["remove"] = async (productId) => {
    if (authed) { await run(async () => apply(await api.delData<CartView>(`/api/cart/items/${productId}`))); return; }
    saveGuest(guest.filter((l) => l.productId !== productId));
  };
  const clear: Ctx["clear"] = async () => {
    if (authed) { await run(async () => apply(await api.delData<CartView>("/api/cart"))); return; }
    saveGuest([]);
  };

  const value: Ctx = useMemo(
    () => ({
      view: authed ? server.data ?? EMPTY : guestBuilt.view,
      loading: authed ? server.isPending : guestBuilt.loading,
      busy, open, setOpen, add, setQty, remove, clear,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [authed, server.data, server.isPending, guest, guestResults.map((r) => r.status).join(), busy, open],
  );
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const c = useContext(CartContext);
  if (!c) throw new Error("useCart must be used inside <CartProvider>");
  return c;
}
