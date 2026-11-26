"use client";
import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { useCart } from "@/lib/cart";
import { LinkButton } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { CartLines } from "./CartLines";
import { CartSummary } from "./CartSummary";

export function CartDrawer() {
  const { open, setOpen, view } = useCart();
  const close = () => setOpen(false);
  return (
    <Modal open={open} onClose={close} title={`Your bag${view.itemCount ? ` (${view.itemCount})` : ""}`} side="right" wide>
      {view.items.length === 0 ? (
        <div className="flex flex-col items-center py-20 text-center">
          <ShoppingBag size={34} className="text-gold" strokeWidth={1.25} />
          <p className="mt-6 font-serif text-2xl">Your bag is empty</p>
          <p className="mt-2 max-w-xs text-sm text-mute">Pieces you add will wait here, even if you come back later.</p>
          <div className="mt-8"><LinkButton href="/products" onClick={close}>Explore the collection</LinkButton></div>
        </div>
      ) : (
        <div className="space-y-8">
          <CartLines onNavigate={close} />
          <div className="border-t border-line pt-6">
            <CartSummary extra={<Link href="/cart" onClick={close} className="mt-5 block text-center text-sm text-ink-soft underline decoration-gold underline-offset-4 hover:text-ink">View full bag</Link>} />
          </div>
        </div>
      )}
    </Modal>
  );
}
