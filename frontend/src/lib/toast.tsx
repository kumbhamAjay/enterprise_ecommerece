"use client";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { CheckCircle2, AlertCircle, X } from "lucide-react";

type Toast = { id: number; kind: "success" | "error"; text: string };
const ToastContext = createContext<(kind: Toast["kind"], text: string) => void>(() => {});
let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = (id: number) => setToasts((t) => t.filter((x) => x.id !== id));
  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = ++nextId;
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => dismiss(id), 4500);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-[100] flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="pointer-events-auto flex max-w-md items-center gap-3 rounded-sm border border-line bg-paper py-3 pl-4 pr-3 text-sm shadow-[0_12px_40px_-12px_rgba(20,17,15,0.25)]"
            style={{ animation: "pop 0.35s var(--ease-premium) both" }}
          >
            {t.kind === "success" ? <CheckCircle2 size={18} className="shrink-0 text-ok" /> : <AlertCircle size={18} className="shrink-0 text-danger" />}
            <span className="text-ink-soft">{t.text}</span>
            <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="ml-1 rounded p-1 text-mute hover:text-ink">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => {
  const push = useContext(ToastContext);
  return { success: (t: string) => push("success", t), error: (t: string) => push("error", t) };
};
