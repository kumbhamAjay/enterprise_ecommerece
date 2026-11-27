import type { ReactNode } from "react";

export function AuthShell({ eyebrow, title, subtitle, children, footer }: { eyebrow: string; title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="grid min-h-[calc(100vh-72px)] lg:grid-cols-[1fr_1.05fr]">
      <aside className="relative hidden overflow-hidden bg-ink text-ivory lg:block">
        <div className="absolute inset-0 opacity-[0.07] [background-image:radial-gradient(circle_at_1px_1px,#fff_1px,transparent_0)] [background-size:28px_28px]" />
        <div className="absolute -bottom-40 -left-40 h-[520px] w-[520px] rounded-full border border-gold/30" />
        <div className="absolute -bottom-24 -left-24 h-[360px] w-[360px] rounded-full border border-gold/20" />
        <div className="relative flex h-full flex-col justify-between p-14">
          <p className="eyebrow !text-ivory/50">Members</p>
          <div>
            <div className="mb-8 h-px w-14 bg-gold" />
            <p className="max-w-md font-serif text-4xl font-light leading-[1.15]">Considered objects, kept close to the people who love them.</p>
            <p className="mt-6 max-w-sm text-sm leading-relaxed text-ivory/55">Create an account to save your details, manage addresses and be first to see new arrivals.</p>
          </div>
          <p className="text-xs tracking-wide text-ivory/35">Secure by design · rotating sessions · verified email</p>
        </div>
      </aside>

      <section className="flex items-center justify-center px-5 py-14 sm:px-10">
        <div className="reveal w-full max-w-[420px]">
          <p className="eyebrow flex items-center gap-4"><span className="h-px w-8 bg-gold" /> {eyebrow}</p>
          <h1 className="mt-5 font-serif text-[2.6rem] font-light leading-[1.05] tracking-tight">{title}</h1>
          {subtitle && <p className="mt-4 text-sm leading-relaxed text-mute">{subtitle}</p>}
          <div className="mt-9">{children}</div>
          {footer && <div className="mt-8 border-t border-line pt-6 text-center text-sm text-mute">{footer}</div>}
        </div>
      </section>
    </div>
  );
}
