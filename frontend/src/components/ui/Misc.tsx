import type { ReactNode } from "react";

export const Skeleton = ({ className = "" }: { className?: string }) => <div className={`skeleton rounded-[2px] ${className}`} />;

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "gold" | "ok" | "danger" }) {
  const t = { neutral: "bg-sand text-ink-soft", gold: "bg-gold-soft text-[#7a5a28]", ok: "bg-[#e3f0e8] text-ok", danger: "bg-[#f8e4e2] text-danger" }[tone];
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[0.6875rem] font-medium tracking-wide ${t}`}>{children}</span>;
}

export function EmptyState({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-20 text-center">
      <div className="mb-6 h-px w-12 bg-gold" />
      <h3 className="font-serif text-2xl">{title}</h3>
      <p className="mt-3 text-sm leading-relaxed text-mute">{text}</p>
      {action && <div className="mt-8">{action}</div>}
    </div>
  );
}

export const Container = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
  <div className={`mx-auto w-full max-w-[1320px] px-5 sm:px-8 lg:px-12 ${className}`}>{children}</div>
);

export function FieldErrorSummary({ message }: { message?: string }) {
  return message ? (
    <div role="alert" className="rounded-[3px] border border-danger/30 bg-[#fbeeed] px-4 py-3 text-sm text-danger">
      {message}
    </div>
  ) : null;
}
