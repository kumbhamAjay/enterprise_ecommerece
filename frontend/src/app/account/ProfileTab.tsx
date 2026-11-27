"use client";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { FieldErrorSummary } from "@/components/ui/Misc";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/lib/toast";
import type { User } from "@/lib/types";

export function ProfileTab({ user }: { user: User }) {
  const { setUser } = useAuth();
  const toast = useToast();
  const [first, setFirst] = useState(user.firstName);
  const [last, setLast] = useState(user.lastName ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const dirty = first.trim() !== user.firstName || last.trim() !== (user.lastName ?? "");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setError("");
    setBusy(true);
    try {
      const u = await api.patch<Pick<User, "firstName" | "lastName">>("/api/users/me", { firstName: first.trim(), lastName: last.trim() });
      setUser({ ...user, ...u });
      toast.success("Profile updated.");
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fields);
        setError(Object.keys(err.fields).length ? "" : err.message);
      }
    }
    setBusy(false);
  }

  return (
    <section className="max-w-xl">
      <h2 className="font-serif text-3xl font-light">Personal details</h2>
      <p className="mt-2 text-sm text-mute">How we address you across ShopEasy.</p>
      <form onSubmit={save} className="mt-9 space-y-6" noValidate>
        <FieldErrorSummary message={error} />
        <div className="grid gap-5 sm:grid-cols-2">
          <Input label="First name" value={first} onChange={(e) => setFirst(e.target.value)} error={errors.firstName} />
          <Input label="Last name" value={last} onChange={(e) => setLast(e.target.value)} error={errors.lastName} />
        </div>
        <Input label="Email" value={user.email} disabled hint="Your email is your sign-in and can’t be changed here." />
        <Button type="submit" loading={busy} disabled={!dirty}>Save changes</Button>
      </form>
    </section>
  );
}
