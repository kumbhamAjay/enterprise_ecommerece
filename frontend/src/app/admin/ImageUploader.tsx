"use client";
import { useRef, useState } from "react";
import { ImagePlus, Loader2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";

type Sign = { cloudName: string; apiKey: string; timestamp: number; folder: string; allowedFormats: string; signature: string; uploadUrl: string };
export type Uploaded = { url: string; publicId: string };
type Job = { id: number; name: string; progress: number; error?: string };

const TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];
const MAX_BYTES = 8 * 1024 * 1024;
let nextJob = 0;

// Browser -> Cloudinary directly. We only ask our server for a short-lived signature (admin only; the API secret never
// reaches the browser), so large files never pass through our API.
async function upload(file: File, onProgress: (pct: number) => void): Promise<Uploaded> {
  const s = await api.post<Sign>("/api/admin/uploads/sign");
  const form = new FormData();
  form.append("file", file);
  form.append("api_key", s.apiKey);
  form.append("timestamp", String(s.timestamp));
  form.append("signature", s.signature);
  form.append("folder", s.folder);
  form.append("allowed_formats", s.allowedFormats);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", s.uploadUrl);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onerror = () => reject(new Error("Network error while uploading"));
    xhr.onload = () => {
      let body: { secure_url?: string; public_id?: string; error?: { message?: string } } = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* handled below */ }
      if (xhr.status === 200 && body.secure_url && body.public_id) resolve({ url: body.secure_url, publicId: body.public_id });
      else reject(new Error(body.error?.message ?? "Upload failed"));
    };
    xhr.send(form);
  });
}

export function ImageUploader({ onUploaded, disabled }: { onUploaded: (img: Uploaded) => void | Promise<unknown>; disabled?: boolean }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const patch = (id: number, p: Partial<Job>) => setJobs((j) => j.map((x) => (x.id === id ? { ...x, ...p } : x)));

  async function handle(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      const id = ++nextJob;
      setJobs((j) => [...j, { id, name: file.name, progress: 0 }]);
      if (!TYPES.includes(file.type)) { patch(id, { error: "Use a JPG, PNG, WebP or AVIF image." }); continue; }
      if (file.size > MAX_BYTES) { patch(id, { error: "Images must be under 8 MB." }); continue; }
      try {
        const img = await upload(file, (progress) => patch(id, { progress }));
        await onUploaded(img);
        setJobs((j) => j.filter((x) => x.id !== id));
      } catch (e) {
        patch(id, { error: e instanceof ApiError && e.status === 503 ? "Image uploads aren’t configured yet. Paste an image URL instead." : e instanceof Error ? e.message : "Upload failed" });
      }
    }
  }

  return (
    <div>
      <label
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled) void handle(e.dataTransfer.files); }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[3px] border border-dashed px-6 py-8 text-center transition-colors ${over ? "border-gold bg-gold-soft/50" : "border-line bg-paper hover:border-ink/40"} ${disabled ? "pointer-events-none opacity-50" : ""}`}
      >
        <ImagePlus size={22} className="text-gold" />
        <span className="text-sm text-ink-soft"><strong className="font-medium text-ink">Click to upload</strong> or drag images here</span>
        <span className="text-xs text-mute">JPG, PNG, WebP or AVIF · up to 8 MB each · the first image is the main one</span>
        <input ref={input} type="file" multiple accept={TYPES.join(",")} className="sr-only" aria-label="Upload product images" onChange={(e) => { if (e.target.files) void handle(e.target.files); e.target.value = ""; }} />
      </label>

      {jobs.length > 0 && (
        <ul className="mt-3 space-y-2" aria-live="polite">
          {jobs.map((j) => (
            <li key={j.id} className="rounded-[3px] border border-line bg-paper px-4 py-2.5 text-xs">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-ink-soft">{j.name}</span>
                {j.error ? (
                  <button type="button" onClick={() => setJobs((x) => x.filter((y) => y.id !== j.id))} className="shrink-0 text-danger underline">Dismiss</button>
                ) : (
                  <span className="flex shrink-0 items-center gap-2 tabular-nums text-mute"><Loader2 size={12} className="animate-spin" /> {j.progress}%</span>
                )}
              </div>
              {j.error ? <p role="alert" className="mt-1 text-danger">{j.error}</p> : <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-line"><div className="h-full bg-gold transition-all" style={{ width: `${j.progress}%` }} /></div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
