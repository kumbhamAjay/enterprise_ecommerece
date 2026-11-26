"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { PasswordInput } from "@/components/ui/Field";
import { FieldErrorSummary } from "@/components/ui/Misc";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/lib/toast";

export function PasswordTab() {
  const { logout } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [v, setV] = useState({ current: "", next: "", confirm: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV((s) => ({ ...s, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (!v.current) local.current = "Enter your current password";
    if (v.next.length < 8) local.next = "Use at least 8 characters";
    if (v.confirm !== v.next) local.confirm = "Passwords don’t match";
    setErrors(local);
    setError("");
    if (Object.keys(local).length) return;

    setBusy(true);
    try {
      await api.post("/api/users/me/password", { currentPassword: v.current, newPassword: v.next });
      await logout(); // the server revoked all sessions; start clean
      toast.success("Password changed. Please sign in again.");
      router.push("/login");
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 400 && err.message.includes("Current password")) setErrors({ current: "That isn’t your current password" });
        else {
          setErrors({ next: err.fields.newPassword ?? "" });
          setError(Object.keys(err.fields).length ? "" : err.message);
        }
      }
      setBusy(false);
    }
  }

  return (
    <section className="max-w-xl">
      <h2 className="font-serif text-3xl font-light">Password &amp; security</h2>
      <p className="mt-2 text-sm text-mute">Changing your password signs you out on every device.</p>
      <form onSubmit={submit} className="mt-9 space-y-6" noValidate>
        <FieldErrorSummary message={error} />
        <PasswordInput label="Current password" autoComplete="current-password" value={v.current} onChange={set("current")} error={errors.current} />
        <PasswordInput label="New password" autoComplete="new-password" value={v.next} onChange={set("next")} error={errors.next} hint="At least 8 characters." />
        <PasswordInput label="Confirm new password" autoComplete="new-password" value={v.confirm} onChange={set("confirm")} error={errors.confirm} />
        <Button type="submit" loading={busy}>Update password</Button>
      </form>
    </section>
  );
}
