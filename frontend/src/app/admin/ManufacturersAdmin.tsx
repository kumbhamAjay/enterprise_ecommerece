"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Input } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { EmptyState, FieldErrorSummary, Skeleton } from "@/components/ui/Misc";
import { api, ApiError } from "@/lib/api";
import { useManufacturers } from "@/lib/hooks";
import { useToast } from "@/lib/toast";
import type { Manufacturer } from "@/lib/types";

export function ManufacturersAdmin() {
  const { data, isPending } = useManufacturers();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<Manufacturer | "new" | null>(null);
  const [removing, setRemoving] = useState<Manufacturer | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["manufacturers"] }); qc.invalidateQueries({ queryKey: ["products"] }); };

  const del = useMutation({
    mutationFn: (id: string) => api.del(`/api/manufacturers/${id}`),
    onSuccess: () => { refresh(); setRemoving(null); toast.success("Brand deleted."); },
    onError: () => { setRemoving(null); toast.error("Could not delete the brand."); },
  });

  return (
    <section className="max-w-3xl">
      <div className="flex items-center justify-between">
        <p className="text-sm text-mute">Brands appear on product pages and in the shop filters.</p>
        <Button onClick={() => setEditing("new")}><Plus size={16} /> New brand</Button>
      </div>
      <div className="mt-8 rounded-[3px] border border-line bg-paper">
        {isPending || !data ? <div className="space-y-3 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
          : data.length === 0 ? <EmptyState title="No brands" text="Add a brand, or import the sample catalog." />
          : data.map((m) => (
            <div key={m.id} className="flex items-center gap-3 border-b border-line px-5 py-3.5 last:border-0 hover:bg-sand/40">
              <span className="flex-1">{m.name}</span>
              <button onClick={() => setEditing(m)} aria-label={`Edit ${m.name}`} className="rounded p-2 text-mute hover:bg-sand hover:text-ink"><Pencil size={15} /></button>
              <button onClick={() => setRemoving(m)} aria-label={`Delete ${m.name}`} className="rounded p-2 text-mute hover:bg-[#f8e4e2] hover:text-danger"><Trash2 size={15} /></button>
            </div>
          ))}
      </div>
      <BrandForm key={editing === "new" ? "new" : editing?.id ?? "closed"} target={editing} onClose={() => setEditing(null)} onSaved={() => { refresh(); setEditing(null); }} />
      <ConfirmDialog open={!!removing} title="Delete this brand?" message={removing ? `“${removing.name}” will be removed. Its products stay in the shop without a brand.` : ""} confirmLabel="Delete" loading={del.isPending} onConfirm={() => removing && del.mutate(removing.id)} onClose={() => setRemoving(null)} />
    </section>
  );
}

function BrandForm({ target, onClose, onSaved }: { target: Manufacturer | "new" | null; onClose: () => void; onSaved: () => void }) {
  const existing = target && target !== "new" ? target : null;
  const toast = useToast();
  const [name, setName] = useState(existing?.name ?? "");
  const [error, setError] = useState("");

  const save = useMutation({
    mutationFn: () => (existing ? api.patch(`/api/manufacturers/${existing.id}`, { name: name.trim() }) : api.post("/api/manufacturers", { name: name.trim() })),
    onSuccess: () => { toast.success(existing ? "Brand updated." : "Brand created."); onSaved(); },
    onError: (e) => setError(e instanceof ApiError && e.status === 409 ? "A brand with this name already exists." : "Could not save the brand."),
  });

  return (
    <Modal open={!!target} onClose={onClose} title={existing ? "Edit brand" : "New brand"}>
      <form onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return setError("Please enter a name."); setError(""); save.mutate(); }} className="space-y-5" noValidate>
        <FieldErrorSummary message={error} />
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>{existing ? "Save changes" : "Create brand"}</Button>
        </div>
      </form>
    </Modal>
  );
}
