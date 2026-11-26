"use client";
import Link from "next/link";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { AuthShell } from "@/components/auth/AuthShell";
import { Button, LinkButton } from "@/components/ui/Button";
import { PasswordInput } from "@/components/ui/Field";
import { FieldErrorSummary } from "@/components/ui/Misc";
import { api, ApiError, clearTokens } from "@/lib/api";

export function ResetForm() {
  const token = useSearchParams().get("token");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (password.length < 8) local.password = "Use at least 8 characters";
    if (confirm !== password) local.confirm = "Passwords don’t match";
    setErrors(local);
    setError("");
    if (Object.keys(local).length) return;

    setBusy(true);
    try {
      await api.post("/api/auth/reset-password", { token, password }, false);
      clearTokens(); // the server revoked every session
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        setError(err.status === 400 && !Object.keys(err.fields).length ? "This reset link is invalid or has expired. Please request a new one." : "");
      } else setError("Network error. Please try again.");
    }
    setBusy(false);
  }

  if (!token)
    return (
      <AuthShell eyebrow="Account recovery" title="Link incomplete" subtitle="This reset link is missing its token." footer={<Link href="/login" className="underline decoration-gold underline-offset-4">Back to sign in</Link>}>
        <LinkButton href="/forgot-password" size="lg" className="w-full">Request a new link</LinkButton>
      </AuthShell>
    );

  return (
    <AuthShell eyebrow="Account recovery" title={done ? "Password updated" : "Choose a new password"} subtitle={done ? undefined : "For your security, you’ll be signed out everywhere."}>
      {done ? (
        <div className="text-center">
          <CheckCircle2 className="mx-auto text-ok" size={34} />
          <p className="mt-4 text-sm text-mute">Your password has been changed. Sign in with your new password.</p>
          <LinkButton href="/login" size="lg" className="mt-8 w-full">Sign in</LinkButton>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-6" noValidate>
          <FieldErrorSummary message={error} />
          {error && <Link href="/forgot-password" className="block text-sm text-gold hover:underline">Request a new link →</Link>}
          <PasswordInput label="New password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} />
          <PasswordInput label="Confirm password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} error={errors.confirm} />
          <Button type="submit" size="lg" loading={busy} className="w-full">Update password</Button>
        </form>
      )}
    </AuthShell>
  );
}
