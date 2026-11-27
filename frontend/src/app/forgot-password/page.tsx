"use client";
import Link from "next/link";
import { useState } from "react";
import { MailCheck } from "lucide-react";
import { AuthShell } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { FieldErrorSummary } from "@/components/ui/Misc";
import { api, ApiError } from "@/lib/api";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.post("/api/auth/forgot-password", { email: email.trim() }, false);
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Network error. Please try again.");
    }
    setBusy(false);
  }

  return (
    <AuthShell eyebrow="Account recovery" title="Forgot your password?" subtitle="Enter your email and we’ll send a link to choose a new one." footer={<Link href="/login" className="font-medium text-ink underline decoration-gold underline-offset-4">Back to sign in</Link>}>
      {sent ? (
        <div className="rounded-[3px] border border-line bg-paper p-6 text-center">
          <MailCheck className="mx-auto text-gold" size={30} />
          <p className="mt-4 font-serif text-xl">Check your inbox</p>
          <p className="mt-2 text-sm leading-relaxed text-mute">If an account exists for <strong className="text-ink-soft">{email}</strong>, a reset link is on its way. It expires in one hour.</p>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-6" noValidate>
          <FieldErrorSummary message={error} />
          <Input label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          <Button type="submit" size="lg" loading={busy} className="w-full">Send reset link</Button>
        </form>
      )}
    </AuthShell>
  );
}
