"use client";
import Link from "next/link";
import { useState } from "react";
import { AuthShell } from "@/components/auth/AuthShell";
import { Button } from "@/components/ui/Button";
import { Input, PasswordInput } from "@/components/ui/Field";
import { FieldErrorSummary } from "@/components/ui/Misc";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useGuestOnly } from "@/lib/guards";
import { useToast } from "@/lib/toast";

function strength(p: string) {
  let s = 0;
  if (p.length >= 8) s++;
  if (p.length >= 12) s++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++;
  if (/\d/.test(p) && /[^A-Za-z0-9]/.test(p)) s++;
  return s; // 0..4
}
const LABELS = ["Too short", "Weak", "Fair", "Good", "Strong"];

export function RegisterForm() {
  useGuestOnly();
  const { register } = useAuth();
  const toast = useToast();
  const [v, setV] = useState({ firstName: "", lastName: "", email: "", password: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV((s) => ({ ...s, [k]: e.target.value }));
  const score = v.password ? strength(v.password) : -1;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (!v.firstName.trim()) local.firstName = "Please enter your first name";
    if (!/^\S+@\S+\.\S+$/.test(v.email.trim())) local.email = "Enter a valid email address";
    if (v.password.length < 8) local.password = "Use at least 8 characters";
    setErrors(local);
    setError("");
    if (Object.keys(local).length) return;

    setBusy(true);
    try {
      await register({ firstName: v.firstName.trim(), lastName: v.lastName.trim() || undefined, email: v.email.trim(), password: v.password });
      toast.success("Welcome to ShopEasy. We’ve sent you a link to verify your email.");
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        setError(err.status === 409 ? "An account with this email already exists." : Object.keys(err.fields).length ? "" : err.message);
      } else setError("Network error. Please try again.");
      setBusy(false);
    }
  }

  return (
    <AuthShell eyebrow="Join ShopEasy" title="Create your account" subtitle="It takes less than a minute." footer={<>Already a member? <Link href="/login" className="font-medium text-ink underline decoration-gold underline-offset-4">Sign in</Link></>}>
      <form onSubmit={submit} className="space-y-6" noValidate>
        <FieldErrorSummary message={error} />
        <div className="grid grid-cols-2 gap-4">
          <Input label="First name" autoComplete="given-name" value={v.firstName} onChange={set("firstName")} error={errors.firstName} />
          <Input label="Last name" autoComplete="family-name" value={v.lastName} onChange={set("lastName")} error={errors.lastName} />
        </div>
        <Input label="Email" type="email" autoComplete="email" value={v.email} onChange={set("email")} error={errors.email} placeholder="you@example.com" />
        <div>
          <PasswordInput label="Password" autoComplete="new-password" value={v.password} onChange={set("password")} error={errors.password} />
          {score >= 0 && (
            <div className="mt-3 flex items-center gap-3" aria-live="polite">
              <div className="flex flex-1 gap-1.5">
                {[1, 2, 3, 4].map((i) => (
                  <span key={i} className={`h-[3px] flex-1 rounded-full transition-colors duration-300 ${i <= score ? (score <= 1 ? "bg-danger" : score === 2 ? "bg-gold" : "bg-ok") : "bg-line"}`} />
                ))}
              </div>
              <span className="w-16 text-right text-xs text-mute">{LABELS[score]}</span>
            </div>
          )}
        </div>
        <Button type="submit" size="lg" loading={busy} className="w-full">Create account</Button>
      </form>
    </AuthShell>
  );
}
