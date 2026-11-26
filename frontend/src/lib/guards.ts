"use client";
import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "./auth";

// Only allow same-site relative redirects (no open-redirect via ?next=https://evil.com)
export const safeNext = (n: string | null, fallback = "/account") => (n && n.startsWith("/") && !n.startsWith("//") ? n : fallback);

/** Pages for signed-out visitors: bounce signed-in users away. */
export function useGuestOnly() {
  const { status } = useAuth();
  const router = useRouter();
  const next = useSearchParams().get("next");
  useEffect(() => {
    if (status === "authed") router.replace(safeNext(next));
  }, [status, next, router]);
  return status;
}

/** Pages that need a session (client-side guard; the API enforces the real check). */
export function useRequireAuth(admin = false) {
  const auth = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (auth.status === "guest") router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [auth.status, router, pathname]);
  return { ...auth, allowed: auth.status === "authed" && (!admin || auth.isAdmin) };
}
