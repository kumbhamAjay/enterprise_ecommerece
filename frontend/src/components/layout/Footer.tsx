import Link from "next/link";
import { Container } from "../ui/Misc";

export function Footer() {
  return (
    <footer className="mt-32 border-t border-line bg-paper">
      <Container className="grid gap-14 py-16 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div className="max-w-xs">
          <p className="font-serif text-3xl leading-none tracking-tight">Shop<em className="italic text-gold">Easy</em></p>
          <p className="mt-5 text-sm leading-relaxed text-mute">A considered selection of objects made to be used, kept and passed on.</p>
        </div>
        <FooterCol title="Shop" links={[["All products", "/products"], ["New arrivals", "/products?sort=newest"]]} />
        <FooterCol title="Account" links={[["Sign in", "/login"], ["Create account", "/register"], ["My orders", "/orders"], ["Addresses", "/account?tab=addresses"]]} />
        <FooterCol title="Help" links={[["Reset password", "/forgot-password"], ["API reference", "/api/docs"]]} />
      </Container>
      <div className="border-t border-line">
        <Container className="flex flex-col justify-between gap-2 py-6 text-xs text-mute sm:flex-row">
          <span>© {new Date().getFullYear()} ShopEasy. A learning project.</span>
          <span>Crafted with care.</span>
        </Container>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <p className="eyebrow">{title}</p>
      <ul className="mt-5 space-y-3 text-sm">
        {links.map(([label, href]) => (
          <li key={label}>
            {href.startsWith("/api") ? (
              // Served by the backend (Swagger), not a Next page: a plain anchor avoids Next prefetching it
              <a href={href} className="text-ink-soft transition-colors hover:text-gold">{label}</a>
            ) : (
              <Link href={href} className="text-ink-soft transition-colors hover:text-gold">{label}</Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
