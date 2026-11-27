"use client";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { FieldErrorSummary, Skeleton } from "@/components/ui/Misc";
import { ProductImage } from "@/components/product/ProductCard";
import { api, ApiError } from "@/lib/api";
import { useCategories, useManufacturers, useProduct } from "@/lib/hooks";
import { useToast } from "@/lib/toast";
import { ImageUploader, type Uploaded } from "./ImageUploader";
import type { ProductSummary } from "@/lib/types";

const blank = { sku: "", name: "", price: "", stock: "", description: "", manufacturerId: "", categoryIds: [] as string[] };

export function ProductForm({ target, onClose, onSaved }: { target: ProductSummary | "new" | null; onClose: () => void; onSaved: () => void }) {
  const id = target && target !== "new" ? target.id : null;
  const { data: detail, isPending: loadingDetail } = useProduct(id);
  const { data: categories } = useCategories();
  const { data: manufacturers } = useManufacturers();
  const qc = useQueryClient();
  const toast = useToast();

  const [v, setV] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [newImage, setNewImage] = useState("");
  // New product: images are held here until the product is saved. Edit: images are saved to the product as soon as they upload.
  const [pending, setPending] = useState<{ url: string; publicId?: string }[]>([]);
  const saved = useRef(false);

  useEffect(() => {
    if (detail)
      setV({ sku: detail.sku, name: detail.name, price: String(Number(detail.price)), stock: "", description: detail.description ?? "", manufacturerId: detail.manufacturer?.id ?? "", categoryIds: detail.categories.map((c) => c.id) });
  }, [detail]);

  const set = (k: "sku" | "name" | "price" | "stock" | "description" | "manufacturerId") => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setV((s) => ({ ...s, [k]: e.target.value }));
  const toggleCat = (cid: string) => setV((s) => ({ ...s, categoryIds: s.categoryIds.includes(cid) ? s.categoryIds.filter((x) => x !== cid) : [...s.categoryIds, cid] }));

  const save = useMutation({
    mutationFn: () => {
      const body = {
        sku: v.sku.trim(),
        name: v.name.trim(),
        price: Number(v.price),
        description: v.description.trim() || undefined,
        manufacturerId: v.manufacturerId || null,
        categoryIds: v.categoryIds,
      };
      if (id) return api.patch(`/api/products/${id}`, { ...body, description: v.description.trim() });
      const images = pending.map(({ url, publicId }) => ({ url, ...(publicId && { publicId }) }));
      return api.post("/api/products", { ...body, images, stock: v.stock === "" ? undefined : Number(v.stock) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["product", id] });
      toast.success(id ? "Product updated." : "Product created.");
      saved.current = true; // the pending uploads now belong to the product: don't discard them
      setPending([]);
      onSaved();
    },
    onError: (e) => {
      if (!(e instanceof ApiError)) return setError("Network error. Please try again.");
      setErrors(e.fields);
      setError(e.status === 409 ? "That SKU or name is already used by another product." : Object.keys(e.fields).length ? "" : e.message);
    },
  });

  const addImage = useMutation({
    mutationFn: (img: { url: string; publicId?: string }) => api.post(`/api/products/${id}/images`, img),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["product", id] }); qc.invalidateQueries({ queryKey: ["products"] }); },
    onError: (e) => toast.error(e instanceof ApiError && (e.fields.url || e.status === 400) ? "That image couldn’t be added. Check the URL." : "Could not add image."),
  });
  const discard = (publicId?: string) => { if (publicId) api.post("/api/admin/uploads/discard", { publicId }).catch(() => {}); }; // don't leave unsaved uploads in storage
  const onUploaded = (img: Uploaded) => (id ? addImage.mutateAsync(img) : setPending((p) => [...p, img]));
  const addByUrl = async () => {
    const url = newImage.trim();
    if (!url) return;
    if (id) await addImage.mutateAsync({ url }).then(() => setNewImage("")).catch(() => {});
    else { setPending((p) => [...p, { url }]); setNewImage(""); }
  };
  const close = () => { if (!id && !saved.current) pending.forEach((p) => discard(p.publicId)); onClose(); };
  const delImage = useMutation({
    mutationFn: (imageId: string) => api.del(`/api/products/${id}/images/${imageId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["product", id] }); qc.invalidateQueries({ queryKey: ["products"] }); },
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (!v.sku.trim()) local.sku = "Required";
    if (!v.name.trim()) local.name = "Required";
    if (v.price === "" || Number.isNaN(Number(v.price)) || Number(v.price) < 0) local.price = "Enter a valid price";
    setErrors(local);
    setError("");
    if (!Object.keys(local).length) save.mutate();
  }

  const loading = !!id && loadingDetail;
  return (
    <Modal open={!!target} onClose={close} title={id ? "Edit product" : "New product"} wide>
      {loading ? (
        <div className="space-y-5"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-28" /></div>
      ) : (
        <form onSubmit={submit} className="space-y-6" noValidate>
          <FieldErrorSummary message={error} />
          <div className="grid gap-5 sm:grid-cols-[1fr_160px]">
            <Input label="Name" value={v.name} onChange={set("name")} error={errors.name} />
            <Input label="Price (USD)" inputMode="decimal" value={v.price} onChange={set("price")} error={errors.price} />
          </div>
          <div className={`grid gap-5 ${id ? "sm:grid-cols-2" : "sm:grid-cols-[1fr_1fr_140px]"}`}>
            <Input label="SKU" value={v.sku} onChange={set("sku")} error={errors.sku} />
            <Select label="Brand" value={v.manufacturerId} onChange={set("manufacturerId")}>
              <option value="">No brand</option>
              {manufacturers?.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
            {!id && <Input label="Stock" inputMode="numeric" value={v.stock} onChange={(e) => setV((s) => ({ ...s, stock: e.target.value.replace(/\D/g, "") }))} placeholder="0" error={errors.stock} />}
          </div>
          {!id && <p className="-mt-3 text-xs text-mute">Opening stock. Change it later from the Inventory tab (every change is recorded).</p>}
          <Textarea label="Description" value={v.description} onChange={set("description")} error={errors.description} />

          <div className="space-y-2">
            <p className="eyebrow !text-ink-soft">Categories</p>
            <div className="flex max-h-36 flex-wrap gap-2 overflow-y-auto rounded-[3px] border border-line bg-paper p-3">
              {!categories?.length && <p className="text-xs text-mute">No categories yet — create them in the Categories tab.</p>}
              {categories?.map((c) => (
                <button type="button" key={c.id} onClick={() => toggleCat(c.id)} aria-pressed={v.categoryIds.includes(c.id)} className={`rounded-full border px-3.5 py-1.5 text-xs capitalize transition-colors ${v.categoryIds.includes(c.id) ? "border-ink bg-ink text-ivory" : "border-line text-ink-soft hover:border-ink"}`}>
                  {c.name}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <p className="eyebrow !text-ink-soft">Images</p>
            <ImageUploader onUploaded={onUploaded} />
            {(id ? (detail?.images.length ?? 0) : pending.length) > 0 && (
              <div className="flex flex-wrap gap-3">
                {id
                  ? detail?.images.map((img, i) => (
                      <div key={img.id} className="group relative h-20 w-20 overflow-hidden rounded-[3px] bg-sand">
                        <ProductImage w={160} src={img.url} alt="" className="h-full w-full object-contain p-1.5" />
                        {i === 0 && <span className="absolute bottom-0 left-0 right-0 bg-ink/80 py-0.5 text-center text-[0.5625rem] uppercase tracking-wider text-ivory">Main</span>}
                        <button type="button" onClick={() => delImage.mutate(img.id)} aria-label="Remove image" className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-ink/80 text-ivory opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"><X size={12} /></button>
                      </div>
                    ))
                  : pending.map((img, i) => (
                      <div key={img.url} className="group relative h-20 w-20 overflow-hidden rounded-[3px] bg-sand">
                        <ProductImage w={160} src={img.url} alt="" className="h-full w-full object-contain p-1.5" />
                        {i === 0 && <span className="absolute bottom-0 left-0 right-0 bg-ink/80 py-0.5 text-center text-[0.5625rem] uppercase tracking-wider text-ivory">Main</span>}
                        <button type="button" onClick={() => { setPending((p) => p.filter((x) => x.url !== img.url)); discard(img.publicId); }} aria-label="Remove image" className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-ink/80 text-ivory opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"><X size={12} /></button>
                      </div>
                    ))}
              </div>
            )}
            <details className="text-sm">
              <summary className="cursor-pointer text-xs text-mute hover:text-ink">Or add an image by URL</summary>
              <div className="mt-3 flex gap-2">
                <input value={newImage} onChange={(e) => setNewImage(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addByUrl(); } }} placeholder="https://… image URL" aria-label="Image URL" className="h-11 flex-1 rounded-[3px] border border-line bg-paper px-4 text-sm focus:border-ink focus:outline-none" />
                <Button type="button" variant="outline" loading={addImage.isPending} disabled={!newImage.trim()} onClick={() => void addByUrl()}><Plus size={15} /> Add</Button>
              </div>
            </details>
          </div>

          <div className="flex justify-end gap-3 border-t border-line pt-6">
            <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
            <Button type="submit" loading={save.isPending}>{id ? "Save changes" : "Create product"}</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
