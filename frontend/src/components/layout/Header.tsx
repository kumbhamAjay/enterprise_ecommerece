"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LogOut, Menu, Package, Search, Settings, ShieldCheck, ShoppingBag, User as UserIcon, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useCart } from "@/lib/cart";
import { initials } from "@/lib/format";
import { Container } from "../ui/Misc";

const nav = [
  { href: "/products", label: "Shop" },
  { href: "/products?sort=newest", label: "New arrivals" },
];

export function Header() {
  const { user, status, isAdmin, logout } = useAuth();
  const { view, setOpen: openBag } = useCart();
  const router = useRouter();
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [menu, setMenu] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(scrollY > 8);
    onScroll();
    addEventListener("scroll", onScroll, { passive: true });
    return () => removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    setMenu(false);
    setMobile(false);
    setSearching(false);
  }, [pathname]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => menuRef.current && !menuRef.current.contains(e.target as Node) && setMenu(false);
    addEventListener("mousedown", onDown);
    return () => removeEventListener("mousedown", onDown);
  }, []);
  useEffect(() => {
    if (searching) searchRef.current?.focus();
  }, [searching]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (q.trim()) router.push(`/products?q=${encodeURIComponent(q.trim())}`);
  };

  return (
    <header className={`sticky top-0 z-50 transition-all duration-500 ${scrolled ? "border-b border-line bg-ivory/85 backdrop-blur-xl" : "border-b border-transparent bg-ivory"}`}>
      <Container className="flex h-[72px] items-center justify-between gap-6">
        <div className="flex items-center gap-10">
          <button className="-ml-2 rounded p-2 lg:hidden" onClick={() => setMobile((m) => !m)} aria-label="Menu">
            {mobile ? <X size={20} /> : <Menu size={20} />}
          </button>
          <Link href="/" className="font-serif text-[1.7rem] leading-none tracking-tight" aria-label="ShopEasy home">
            Shop<em className="italic text-gold">Easy</em>
          </Link>
          <nav className="hidden items-center gap-8 lg:flex">
            {nav.map((n) => (
              <Link key={n.label} href={n.href} className="group relative py-2 text-[0.8125rem] tracking-wide text-ink-soft transition-colors hover:text-ink">
                {n.label}
                <span className="absolute inset-x-0 bottom-0 h-px origin-left scale-x-0 bg-gold transition-transform duration-500 ease-[var(--ease-premium)] group-hover:scale-x-100" />
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-1">
          <form onSubmit={submit} className={`flex items-center overflow-hidden transition-all duration-500 ease-[var(--ease-premium)] ${searching ? "w-48 sm:w-72" : "w-0"}`}>
            <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the collection" aria-label="Search" className="w-full border-b border-ink bg-transparent py-1.5 text-sm placeholder:text-mute focus:outline-none" />
          </form>
          <button onClick={() => setSearching((s) => !s)} aria-label="Search" className="rounded-full p-2.5 text-ink-soft transition-colors hover:bg-sand hover:text-ink">
            <Search size={19} />
          </button>

          <button onClick={() => openBag(true)} aria-label={`Open bag, ${view.itemCount} ${view.itemCount === 1 ? "item" : "items"}`} className="relative rounded-full p-2.5 text-ink-soft transition-colors hover:bg-sand hover:text-ink">
            <ShoppingBag size={19} />
            {view.itemCount > 0 && <span className="absolute right-0.5 top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-gold px-1 text-[0.625rem] font-medium leading-none text-white" style={{ animation: "pop 0.3s var(--ease-premium) both" }} key={view.itemCount}>{view.itemCount}</span>}
          </button>

          {status === "loading" ? (
            <div className="skeleton ml-2 h-9 w-9 rounded-full" />
          ) : user ? (
            <div className="relative ml-1" ref={menuRef}>
              <button onClick={() => setMenu((m) => !m)} aria-label="Account menu" aria-expanded={menu} className="grid h-9 w-9 place-items-center rounded-full bg-ink text-[0.6875rem] font-medium tracking-wider text-ivory transition-transform hover:scale-105">
                {initials(user.firstName, user.lastName)}
              </button>
              {menu && (
                <div className="absolute right-0 top-12 w-64 overflow-hidden rounded-[4px] border border-line bg-paper shadow-[0_24px_60px_-20px_rgba(20,17,15,0.35)]" style={{ animation: "pop 0.25s var(--ease-premium) both" }}>
                  <div className="border-b border-line px-5 py-4">
                    <p className="font-serif text-lg leading-tight">{user.firstName} {user.lastName}</p>
                    <p className="mt-1 truncate text-xs text-mute">{user.email}</p>
                  </div>
                  <div className="p-1.5 text-sm">
                    <MenuLink href="/account" icon={<UserIcon size={16} />}>My account</MenuLink>
                    <MenuLink href="/orders" icon={<Package size={16} />}>My orders</MenuLink>
                    {isAdmin && <MenuLink href="/admin" icon={<ShieldCheck size={16} />}>Catalog admin</MenuLink>}
                    <MenuLink href="/account?tab=addresses" icon={<Settings size={16} />}>Addresses</MenuLink>
                    <button onClick={() => logout().then(() => router.push("/"))} className="flex w-full items-center gap-3 rounded-[3px] px-3.5 py-2.5 text-left text-ink-soft transition-colors hover:bg-sand hover:text-ink">
                      <LogOut size={16} /> Sign out
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="ml-2 flex items-center gap-1">
              <Link href="/login" className="rounded px-3 py-2 text-[0.8125rem] tracking-wide text-ink-soft transition-colors hover:text-ink">Sign in</Link>
              <Link href="/register" className="hidden h-9 items-center rounded-[3px] bg-ink px-5 text-xs font-medium tracking-wide text-ivory transition-colors hover:bg-[#2a2420] sm:inline-flex">Create account</Link>
            </div>
          )}
        </div>
      </Container>

      {mobile && (
        <nav className="border-t border-line bg-ivory lg:hidden" style={{ animation: "fade-in 0.25s both" }}>
          <Container className="flex flex-col py-3">
            {nav.map((n) => (
              <Link key={n.label} href={n.href} className="border-b border-line/60 py-4 font-serif text-xl last:border-0">{n.label}</Link>
            ))}
          </Container>
        </nav>
      )}
    </header>
  );
}

function MenuLink({ href, icon, children }: { href: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Link href={href} className="flex items-center gap-3 rounded-[3px] px-3.5 py-2.5 text-ink-soft transition-colors hover:bg-sand hover:text-ink">
      {icon} {children}
    </Link>
  );
}
