import Link from "next/link";
import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

const variants = {
  primary: "bg-ink text-ivory hover:bg-[#2a2420] disabled:bg-ink/40",
  gold: "bg-gold text-white hover:bg-[#8f6a32] disabled:bg-gold/40",
  outline: "border border-ink/80 text-ink hover:bg-ink hover:text-ivory disabled:border-line disabled:text-mute disabled:hover:bg-transparent",
  ghost: "text-ink-soft hover:bg-sand hover:text-ink",
  danger: "border border-danger/40 text-danger hover:bg-danger hover:text-white",
};
const sizes = { sm: "h-9 px-4 text-xs", md: "h-11 px-6 text-sm", lg: "h-13 px-8 text-sm" };

type Common = { variant?: keyof typeof variants; size?: keyof typeof sizes; loading?: boolean; className?: string; children: ReactNode };

const cls = ({ variant = "primary", size = "md", className = "" }: Common) =>
  `inline-flex items-center justify-center gap-2 rounded-[3px] font-medium tracking-wide transition-all duration-300 ease-[var(--ease-premium)] active:scale-[0.985] disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${className}`;

export function Button({ loading, children, disabled, ...p }: Common & ButtonHTMLAttributes<HTMLButtonElement>) {
  const { variant, size, className, ...rest } = p;
  return (
    <button {...rest} disabled={disabled || loading} className={cls({ variant, size, className, children })}>
      {loading && <Loader2 size={16} className="animate-spin" />}
      {children}
    </button>
  );
}

export function LinkButton({ href, children, onClick, ...p }: Common & { href: string; onClick?: () => void }) {
  return (
    <Link href={href} onClick={onClick} className={cls({ ...p, children })}>
      {children}
    </Link>
  );
}
