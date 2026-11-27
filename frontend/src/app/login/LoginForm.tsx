"use client";
import Link from "next/link";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/Button";
import { Input, PasswordInput } from "@/components/ui/Field";
import { FieldErrorSummary } from "@/components/ui/Misc";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useGuestOnly } from "@/lib/guards";

export function LoginForm() {
  useGuestOnly();
  const { login } = useAuth();
  const next = useSearchParams().get("next");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await login(email.trim(), password); // useGuestOnly redirects once the session is set
    } catch (err) {
      setError(err instanceof ApiError ? (err.status === 401 ? "That email and password don’t match." : err.message) : "Network error. Please try again.");
      setBusy(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Welcome back"
      title="Sign in"
      subtitle="Access your account, addresses and saved details."
      footer={<>New to ShopEasy? <Link href={`/register${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-medium text-ink underline decoration-gold underline-offset-4">Create an account</Link></>}
    >
      <form onSubmit={submit} className="space-y-6" noValidate>
        <FieldErrorSummary message={error} />
        <Input label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        <PasswordInput label="Password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} right={<Link href="/forgot-password" className="text-xs text-gold hover:underline">Forgot?</Link>} />
        <Button type="submit" size="lg" loading={busy} className="w-full">Sign in</Button>
      </form>
    </AuthShell>
  );
}
