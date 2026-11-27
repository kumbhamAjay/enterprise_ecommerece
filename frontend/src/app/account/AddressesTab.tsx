"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MapPin, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Input } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Badge, EmptyState, FieldErrorSummary, Skeleton } from "@/components/ui/Misc";
import { api, ApiError } from "@/lib/api";
import { useAddresses } from "@/lib/hooks";
import { useToast } from "@/lib/toast";
import type { Address } from "@/lib/types";

const empty = { addressLine1: "", city: "", state: "", postalCode: "", country: "", isDefault: false };

export function AddressesTab() {
  const { data, isPending, isError } = useAddresses(true);
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<Address | "new" | null>(null);
  const [deleting, setDeleting] = useState<Address | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["account", "addresses"] });

  const del = useMutation({
    mutationFn: (id: string) => api.del(`/api/users/me/addresses/${id}`),
    onSuccess: () => { refresh(); setDeleting(null); toast.success("Address removed."); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not remove address."),
  });
  const makeDefault = useMutation({
    mutationFn: (id: string) => api.patch(`/api/users/me/addresses/${id}`, { isDefault: true }),
    onSuccess: () => { refresh(); toast.success("Default address updated."); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not update."),
  });

  return (
    <section>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="font-serif text-3xl font-light">Addresses</h2>
          <p className="mt-2 text-sm text-mute">Where your orders will be delivered.</p>
        </div>
        <Button onClick={() => setEditing("new")}><Plus size={16} /> Add address</Button>
      </div>

      <div className="mt-9">
        {isPending ? (
          <div className="grid gap-5 sm:grid-cols-2"><Skeleton className="h-44" /><Skeleton className="h-44" /></div>
        ) : isError ? (
          <p className="text-sm text-danger">We couldn’t load your addresses.</p>
        ) : data.length === 0 ? (
          <div className="rounded-[3px] border border-dashed border-line bg-paper/50">
            <EmptyState title="No addresses yet" text="Save an address now to make checkout effortless later." action={<Button variant="outline" onClick={() => setEditing("new")}><Plus size={16} /> Add your first address</Button>} />
          </div>
        ) : (
          <ul className="grid gap-5 sm:grid-cols-2">
            {data.map((a) => (
              <li key={a.id} className={`relative flex flex-col rounded-[3px] border bg-paper p-6 transition-shadow hover:shadow-[0_18px_40px_-24px_rgba(20,17,15,0.3)] ${a.isDefault ? "border-gold/60" : "border-line"}`}>
                <div className="flex items-start justify-between gap-3">
                  <MapPin size={18} className="text-gold" />
                  {a.isDefault && <Badge tone="gold">Default</Badge>}
                </div>
                <address className="mt-4 flex-1 text-sm not-italic leading-relaxed text-ink-soft">
                  <span className="text-ink">{a.addressLine1}</span><br />
                  {[a.city, a.state, a.postalCode].filter(Boolean).join(", ")}<br />
                  {a.country}
                </address>
                <div className="mt-5 flex items-center gap-1 border-t border-line pt-4">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(a)}><Pencil size={14} /> Edit</Button>
                  {!a.isDefault && <Button variant="ghost" size="sm" loading={makeDefault.isPending && makeDefault.variables === a.id} onClick={() => makeDefault.mutate(a.id)}><Star size={14} /> Make default</Button>}
                  <Button variant="ghost" size="sm" className="ml-auto !text-danger" onClick={() => setDeleting(a)} aria-label="Delete address"><Trash2 size={14} /></Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <AddressForm key={editing === "new" ? "new" : editing?.id ?? "closed"} address={editing} onClose={() => setEditing(null)} onSaved={() => { refresh(); setEditing(null); }} />
      <ConfirmDialog open={!!deleting} title="Remove this address?" message={deleting ? `${deleting.addressLine1}, ${deleting.city} will be permanently removed.` : ""} confirmLabel="Remove" loading={del.isPending} onConfirm={() => deleting && del.mutate(deleting.id)} onClose={() => setDeleting(null)} />
    </section>
  );
}

function AddressForm({ address, onClose, onSaved }: { address: Address | "new" | null; onClose: () => void; onSaved: () => void }) {
  const existing = address && address !== "new" ? address : null;
  const toast = useToast();
  const [v, setV] = useState(existing ? { addressLine1: existing.addressLine1, city: existing.city, state: existing.state ?? "", postalCode: existing.postalCode ?? "", country: existing.country, isDefault: existing.isDefault } : empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement>) => setV((s) => ({ ...s, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: () => {
      const body = { ...v, state: v.state || undefined, postalCode: v.postalCode || undefined };
      return existing ? api.patch(`/api/users/me/addresses/${existing.id}`, body) : api.post("/api/users/me/addresses", body);
    },
    onSuccess: () => { toast.success(existing ? "Address updated." : "Address added."); onSaved(); },
    onError: (e) => {
      if (e instanceof ApiError) { setErrors(e.fields); setError(Object.keys(e.fields).length ? "" : e.message); }
    },
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (!v.addressLine1.trim()) local.addressLine1 = "Required";
    if (!v.city.trim()) local.city = "Required";
    if (!v.country.trim()) local.country = "Required";
    setErrors(local);
    setError("");
    if (!Object.keys(local).length) save.mutate();
  }

  return (
    <Modal open={!!address} onClose={onClose} title={existing ? "Edit address" : "New address"}>
      <form onSubmit={submit} className="space-y-5" noValidate>
        <FieldErrorSummary message={error} />
        <Input label="Street address" autoComplete="address-line1" value={v.addressLine1} onChange={set("addressLine1")} error={errors.addressLine1} />
        <div className="grid grid-cols-2 gap-4">
          <Input label="City" autoComplete="address-level2" value={v.city} onChange={set("city")} error={errors.city} />
          <Input label="State / region" autoComplete="address-level1" value={v.state} onChange={set("state")} error={errors.state} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Input label="Postal code" autoComplete="postal-code" value={v.postalCode} onChange={set("postalCode")} error={errors.postalCode} />
          <Input label="Country" autoComplete="country-name" value={v.country} onChange={set("country")} error={errors.country} />
        </div>
        <label className="flex cursor-pointer items-center gap-3 text-sm text-ink-soft">
          <input type="checkbox" checked={v.isDefault} onChange={(e) => setV((s) => ({ ...s, isDefault: e.target.checked }))} className="h-4 w-4 accent-[var(--color-gold)]" />
          Use as my default address
        </label>
        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>{existing ? "Save changes" : "Add address"}</Button>
        </div>
      </form>
    </Modal>
  );
}
