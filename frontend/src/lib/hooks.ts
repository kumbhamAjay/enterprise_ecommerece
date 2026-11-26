"use client";
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { qs } from "./format";
import type { Address, Category, CheckoutPreview, EmailRow, EmailStats, InventoryItem, LedgerEntry, Feed, Manufacturer, Order, OrderListItem, Page, ProductDetail, ProductQuery, ProductSummary } from "./types";

export const useProducts = (q: ProductQuery) =>
  useQuery({
    queryKey: ["products", q],
    queryFn: () => api.page<Page<ProductSummary>>(`/api/products?${qs({ ...q })}`),
    placeholderData: keepPreviousData, // keep the old page on screen while the next loads
  });

// Storefront: "load more" with a cursor (keyset pagination): fast at any depth and stable while products are added
export const useProductFeed = (q: Omit<ProductQuery, "page" | "cursor">) =>
  useInfiniteQuery({
    queryKey: ["products", "feed", q],
    queryFn: ({ pageParam }) => api.page<Feed<ProductSummary>>(`/api/products?${qs({ ...q, cursor: pageParam })}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
  });

export const useProduct = (id: string | null) =>
  useQuery({ queryKey: ["product", id], queryFn: () => api.get<ProductDetail>(`/api/products/${id}`), enabled: !!id });

export const useCategories = () =>
  useQuery({ queryKey: ["categories"], queryFn: () => api.get<Category[]>("/api/categories"), staleTime: 5 * 60_000 });

export const useManufacturers = () =>
  useQuery({ queryKey: ["manufacturers"], queryFn: () => api.get<Manufacturer[]>("/api/manufacturers"), staleTime: 5 * 60_000 });

export const useAddresses = (enabled: boolean) =>
  useQuery({ queryKey: ["account", "addresses"], queryFn: () => api.get<Address[]>("/api/users/me/addresses"), enabled });

// ---- inventory (admin) ----
export const useInventory = (q: { q?: string; lowStock?: string; page?: number; limit?: number }, enabled = true) =>
  useQuery({ queryKey: ["inventory", "list", q], queryFn: () => api.page<Page<InventoryItem>>(`/api/inventory?${qs({ ...q })}`), placeholderData: keepPreviousData, enabled });

export const useInventoryItem = (id: string | null) =>
  useQuery({ queryKey: ["inventory", "item", id], queryFn: () => api.get<InventoryItem>(`/api/inventory/${id}`), enabled: !!id });

export const useLedger = (id: string | null, page: number) =>
  useQuery({ queryKey: ["inventory", "ledger", id, page], queryFn: () => api.page<Page<LedgerEntry>>(`/api/inventory/${id}/history?page=${page}&limit=6`), enabled: !!id, placeholderData: keepPreviousData });

// ---- orders ----
export const useCheckoutPreview = (enabled: boolean) =>
  useQuery({ queryKey: ["checkout", "preview"], queryFn: () => api.get<CheckoutPreview>("/api/checkout/preview"), enabled, staleTime: 0 });

// Orders change behind the user's back (a payment confirmation, an admin moving it along), so never show a cached status
// as current: always refetch when the page opens, and keep checking while an order is still unpaid.
export const useOrders = (page: number) =>
  useQuery({
    queryKey: ["orders", "mine", page],
    queryFn: () => api.page<Page<OrderListItem>>(`/api/orders?page=${page}&limit=8`),
    placeholderData: keepPreviousData,
    refetchOnMount: "always",
    refetchInterval: (q) => (q.state.data?.data.some((o) => o.status === "PENDING_PAYMENT") ? 5000 : false),
  });

export const useOrder = (id: string | null) =>
  useQuery({
    queryKey: ["orders", "one", id],
    queryFn: () => api.get<Order>(`/api/orders/${id}`),
    enabled: !!id,
    refetchOnMount: "always",
    refetchInterval: (q) => (q.state.data?.status === "PENDING_PAYMENT" ? 5000 : false),
  });

export const useAdminOrders = (q: { q?: string; status?: string; page?: number; limit?: number }) =>
  useQuery({ queryKey: ["orders", "admin", q], queryFn: () => api.page<Page<OrderListItem>>(`/api/admin/orders?${qs({ ...q })}`), placeholderData: keepPreviousData });

// ---- emails (admin) ----
export const useEmailStats = () =>
  useQuery({ queryKey: ["emails", "stats"], queryFn: () => api.get<EmailStats>("/api/admin/emails/stats"), refetchInterval: 10_000 });

export const useEmails = (status: string, page: number) =>
  useQuery({
    queryKey: ["emails", "list", status, page],
    queryFn: () => api.page<Page<EmailRow>>(`/api/admin/emails?${qs({ status: status || undefined, page, limit: 12 })}`),
    placeholderData: keepPreviousData,
    refetchInterval: 10_000, // statuses change in the background as workers send and retry
  });
