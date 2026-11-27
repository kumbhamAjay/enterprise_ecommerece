"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Lock } from "lucide-react";
import { useRequireAuth } from "@/lib/guards";
import { Container, Skeleton } from "@/components/ui/Misc";
import { LinkButton } from "@/components/ui/Button";
import { ProductsAdmin } from "./ProductsAdmin";
import { CategoriesAdmin } from "./CategoriesAdmin";
import { ManufacturersAdmin } from "./ManufacturersAdmin";
import { InventoryAdmin } from "./InventoryAdmin";
import { OrdersAdmin } from "./OrdersAdmin";
import { EmailsAdmin } from "./EmailsAdmin";
import { AnalyticsAdmin } from "./AnalyticsAdmin";
import { UsersAdmin } from "./UsersAdmin";
import { useInventory } from "@/lib/hooks";

const TABS = [["analytics", "Analytics"], ["orders", "Orders"], ["products", "Products"], ["inventory", "Inventory"], ["categories", "Categories"], ["brands", "Brands"], ["users", "Users"], ["emails", "Emails"]] as const;

export function Admin() {
  const { status, allowed } = useRequireAuth(true);
  const router = useRouter();
  const lowStock = useInventory({ lowStock: "true", limit: 1 }, allowed).data?.meta.total ?? 0; // badge on the Inventory tab
  const params = useSearchParams(); // a hook: call it once, at the top level, never inside a callback or loop
  const tab = TABS.find(([id]) => id === params.get("tab"))?.[0] ?? "analytics";

  if (status === "loading" || status === "guest")
    return <Container className="py-16"><Skeleton className="h-12 w-72" /><Skeleton className="mt-10 h-96 w-full" /></Container>;

  if (!allowed)
    return (
      <Container className="grid min-h-[50vh] place-items-center py-20 text-center">
        <div>
          <Lock className="mx-auto text-gold" size={30} />
          <h1 className="mt-5 font-serif text-4xl font-light">Admins only</h1>
          <p className="mx-auto mt-3 max-w-sm text-sm text-mute">Your account doesn’t have permission to manage the catalog.</p>
          <div className="mt-8"><LinkButton href="/" variant="outline">Back to the shop</LinkButton></div>
        </div>
      </Container>
    );

  return (
    <Container className="py-12 lg:py-16">
      <div className="reveal">
        <p className="eyebrow flex items-center gap-4"><span className="h-px w-8 bg-gold" /> Back office</p>
        <h1 className="mt-4 font-serif text-5xl font-light tracking-tight">Dashboard</h1>
      </div>
      <div role="tablist" className="mt-10 flex gap-1 border-b border-line">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => router.replace(`/admin?tab=${id}`, { scroll: false })} className={`relative px-5 py-3.5 text-sm transition-colors ${tab === id ? "text-ink" : "text-mute hover:text-ink"}`}>
            {label}
            {id === "inventory" && lowStock > 0 && <span className="ml-2 rounded-full bg-gold px-1.5 py-0.5 align-middle text-[0.625rem] font-medium text-white" aria-label={`${lowStock} low on stock`}>{lowStock}</span>}
            <span className={`absolute inset-x-0 -bottom-px h-px bg-ink transition-transform duration-500 ease-[var(--ease-premium)] ${tab === id ? "scale-x-100" : "scale-x-0"}`} />
          </button>
        ))}
      </div>
      <div key={tab} className="reveal pt-10">
        {tab === "analytics" && <AnalyticsAdmin />}
        {tab === "users" && <UsersAdmin />}
        {tab === "orders" && <OrdersAdmin />}
        {tab === "products" && <ProductsAdmin />}
        {tab === "inventory" && <InventoryAdmin />}
        {tab === "categories" && <CategoriesAdmin />}
        {tab === "brands" && <ManufacturersAdmin />}
        {tab === "emails" && <EmailsAdmin />}
      </div>
    </Container>
  );
}
