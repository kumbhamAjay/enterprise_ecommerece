"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BadgeCheck, MailWarning, MapPin, ShieldCheck, UserRound } from "lucide-react";
import { useRequireAuth } from "@/lib/guards";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { Button } from "@/components/ui/Button";
import { Badge, Container, Skeleton } from "@/components/ui/Misc";
import { ProfileTab } from "./ProfileTab";
import { PasswordTab } from "./PasswordTab";
import { AddressesTab } from "./AddressesTab";

const TABS = [
  { id: "profile", label: "Profile", icon: UserRound },
  { id: "addresses", label: "Addresses", icon: MapPin },
  { id: "security", label: "Security", icon: ShieldCheck },
] as const;

export function Account() {
  const { user, allowed } = useRequireAuth();
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const tab = TABS.find((t) => t.id === params.get("tab"))?.id ?? "profile";
  const [sending, setSending] = useState(false);

  if (!allowed || !user)
    return (
      <Container className="py-16">
        <Skeleton className="h-14 w-80" />
        <Skeleton className="mt-10 h-96 w-full" />
      </Container>
    );

  async function resend() {
    setSending(true);
    try {
      await api.post("/api/auth/resend-verification");
      toast.success("Verification email sent. Check your inbox.");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not send the email.");
    }
    setSending(false);
  }

  return (
    <Container className="py-12 lg:py-16">
      <div className="reveal">
        <p className="eyebrow flex items-center gap-4"><span className="h-px w-8 bg-gold" /> My account</p>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <h1 className="font-serif text-5xl font-light tracking-tight">Hello, {user.firstName}.</h1>
          {user.emailVerified ? <Badge tone="ok"><BadgeCheck size={13} className="mr-1.5" /> Email verified</Badge> : <Badge tone="gold">Email not verified</Badge>}
        </div>
      </div>

      {!user.emailVerified && (
        <div className="reveal mt-8 flex flex-col gap-4 rounded-[3px] border border-gold/30 bg-gold-soft/50 p-5 sm:flex-row sm:items-center sm:justify-between" style={{ animationDelay: "80ms" }}>
          <div className="flex items-start gap-3.5">
            <MailWarning size={20} className="mt-0.5 shrink-0 text-gold" />
            <p className="text-sm leading-relaxed text-[#6d5126]">Please verify <strong>{user.email}</strong> to secure your account and receive order updates.</p>
          </div>
          <Button variant="outline" size="sm" loading={sending} onClick={resend} className="shrink-0">Resend email</Button>
        </div>
      )}

      <div className="mt-12 grid gap-10 lg:grid-cols-[220px_1fr] lg:gap-16">
        <nav aria-label="Account sections" className="flex gap-2 overflow-x-auto border-b border-line pb-px lg:flex-col lg:gap-1 lg:border-0">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => router.replace(`/account?tab=${id}`, { scroll: false })} aria-current={tab === id ? "page" : undefined} className={`flex shrink-0 items-center gap-3 rounded-[3px] px-4 py-3 text-sm transition-colors ${tab === id ? "bg-ink text-ivory" : "text-ink-soft hover:bg-sand"}`}>
              <Icon size={16} /> {label}
            </button>
          ))}
        </nav>

        <div key={tab} className="reveal min-w-0">
          {tab === "profile" && <ProfileTab user={user} />}
          {tab === "addresses" && <AddressesTab />}
          {tab === "security" && <PasswordTab />}
        </div>
      </div>
    </Container>
  );
}
