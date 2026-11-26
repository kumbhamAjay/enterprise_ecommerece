"use client";
import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CornerDownRight, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Input, Select } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { EmptyState, FieldErrorSummary, Skeleton } from "@/components/ui/Misc";
import { api, ApiError } from "@/lib/api";
import { useCategories } from "@/lib/hooks";
import { useToast } from "@/lib/toast";
import type { Category } from "@/lib/types";

export function CategoriesAdmin() {
  const { data, isPending } = useCategories();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<Category | "new" | null>(null);
  const [removing, setRemoving] = useState<Category | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["categories"] });

  // Depth-first flatten so children render right under their parent
  const rows = useMemo(() => {
    const out: (Category & { depth: number })[] = [];
    const walk = (parent: string | null, depth: number) =>
      data?.filter((c) => c.parentId === parent).forEach((c) => { out.push({ ...c, depth }); walk(c.id, depth + 1); });
    walk(null, 0);
    return out;
  }, [data]);

  const del = useMutation({
    mutationFn: (id: string) => api.del(`/api/categories/${id}`),
    onSuccess: () => { refresh(); setRemoving(null); toast.success("Category deleted."); },
    onError: (e) => { setRemoving(null); toast.error(e instanceof ApiError && e.status === 409 ? "Delete or move its sub-categories first." : "Could not delete."); },
  });

  return (
    <section className="max-w-3xl">
      <div className="flex items-center justify-between">
        <p className="text-sm text-mute">Organise the shop. Sub-categories are included when shoppers filter by a parent.</p>
        <Button onClick={() => setEditing("new")}><Plus size={16} /> New category</Button>
      </div>
      <div className="mt-8 rounded-[3px] border border-line bg-paper">
        {isPending ? <div className="space-y-3 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
          : rows.length === 0 ? <EmptyState title="No categories" text="Create a category, then assign products to it." />
          : rows.map((c) => (
            <div key={c.id} className="flex items-center gap-3 border-b border-line px-5 py-3.5 last:border-0 hover:bg-sand/40" style={{ paddingLeft: 20 + c.depth * 28 }}>
              {c.depth > 0 && <CornerDownRight size={15} className="text-gold" />}
              <span className="flex-1 capitalize">{c.name}</span>
              <span className="hidden font-mono text-xs text-mute sm:block">{c.slug}</span>
              <button onClick={() => setEditing(c)} aria-label={`Edit ${c.name}`} className="rounded p-2 text-mute hover:bg-sand hover:text-ink"><Pencil size={15} /></button>
              <button onClick={() => setRemoving(c)} aria-label={`Delete ${c.name}`} className="rounded p-2 text-mute hover:bg-[#f8e4e2] hover:text-danger"><Trash2 size={15} /></button>
            </div>
          ))}
      </div>
      <CategoryForm key={editing === "new" ? "new" : editing?.id ?? "closed"} target={editing} all={data ?? []} onClose={() => setEditing(null)} onSaved={() => { refresh(); setEditing(null); }} />
      <ConfirmDialog open={!!removing} title="Delete this category?" message={removing ? `“${removing.name}” will be removed. Products stay in the shop, just without this category.` : ""} confirmLabel="Delete" loading={del.isPending} onConfirm={() => removing && del.mutate(removing.id)} onClose={() => setRemoving(null)} />
    </section>
  );
}

function CategoryForm({ target, all, onClose, onSaved }: { target: Category | "new" | null; all: Category[]; onClose: () => void; onSaved: () => void }) {
  const existing = target && target !== "new" ? target : null;
  const toast = useToast();
  const [name, setName] = useState(existing?.name ?? "");
  const [slug, setSlug] = useState(existing?.slug ?? "");
  const [parentId, setParentId] = useState(existing?.parentId ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  const save = useMutation({
    mutationFn: () => {
      const body = { name: name.trim(), slug: slug.trim() || undefined, parentId: parentId || null };
      return existing ? api.patch(`/api/categories/${existing.id}`, body) : api.post("/api/categories", body);
    },
    onSuccess: () => { toast.success(existing ? "Category updated." : "Category created."); onSaved(); },
    onError: (e) => {
      if (!(e instanceof ApiError)) return;
      setErrors(e.fields);
      setError(e.status === 409 ? "A category with this name or slug already exists." : e.status === 400 && !Object.keys(e.fields).length ? "A category can’t be its own parent." : Object.keys(e.fields).length ? "" : e.message);
    },
  });

  return (
    <Modal open={!!target} onClose={onClose} title={existing ? "Edit category" : "New category"}>
      <form onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return setErrors({ name: "Required" }); setErrors({}); setError(""); save.mutate(); }} className="space-y-5" noValidate>
        <FieldErrorSummary message={error} />
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} />
        <Input label="Slug" value={slug} onChange={(e) => setSlug(e.target.value)} error={errors.slug} hint="Optional. Lowercase letters, digits and dashes. Generated from the name when empty." />
        <Select label="Parent category" value={parentId} onChange={(e) => setParentId(e.target.value)}>
          <option value="">None (top level)</option>
          {all.filter((c) => c.id !== existing?.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>{existing ? "Save changes" : "Create category"}</Button>
        </div>
      </form>
    </Modal>
  );
}
