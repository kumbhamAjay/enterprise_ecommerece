"use client";
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

type Props = { open: boolean; onClose: () => void; title: string; children: ReactNode; side?: "center" | "right" | "left"; wide?: boolean };

// Modal (center) or sheet (side). Escape closes, body scroll is locked while open.
export function Modal({ open, onClose, title, children, side = "center", wide }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;

  const panel =
    side === "center"
      ? `m-auto w-full ${wide ? "max-w-2xl" : "max-w-lg"} max-h-[92vh] rounded-[4px]`
      : `h-full w-full ${wide ? "max-w-xl" : "max-w-sm"} ${side === "right" ? "ml-auto" : "mr-auto"}`;
  const anim = side === "center" ? "pop 0.35s var(--ease-premium) both" : `${side === "right" ? "slide-in-right" : "slide-in-left"} 0.4s var(--ease-premium) both`;

  // Portal to <body>: animated page wrappers create stacking contexts that would trap the modal under the sticky header
  return createPortal(
    <div className="fixed inset-0 z-[90] flex p-0 sm:p-6" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]" style={{ animation: "fade-in 0.3s both" }} onClick={onClose} />
      <div className={`relative flex flex-col overflow-hidden bg-ivory shadow-[0_30px_80px_-20px_rgba(20,17,15,0.45)] ${panel}`} style={{ animation: anim }}>
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 className="font-serif text-xl">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded p-2 text-mute transition-colors hover:bg-sand hover:text-ink">
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto p-6">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
