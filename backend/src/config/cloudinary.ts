import { v2 as cloudinary } from "cloudinary";
import { HttpError } from "../utils/httpError";

// Uploads happen browser -> Cloudinary with a signature from us; this server never receives the file bytes.
export const UPLOAD_FOLDER = "shopeasy/products";
export const ALLOWED_FORMATS = "jpg,jpeg,png,webp,avif";
export const PUBLIC_ID_PATTERN = /^shopeasy\/products\/[\w\-./]+$/; // an admin can only reference assets inside our own folder

// Either three variables, or the single CLOUDINARY_URL=cloudinary://<api_key>:<api_secret>@<cloud_name> Cloudinary hands out.
function readCreds(): { cloudName: string; apiKey: string; apiSecret: string } | undefined {
  let { CLOUDINARY_CLOUD_NAME: cloudName, CLOUDINARY_API_KEY: apiKey, CLOUDINARY_API_SECRET: apiSecret } = process.env;
  if ((!cloudName || !apiKey || !apiSecret) && process.env.CLOUDINARY_URL) {
    try {
      const u = new URL(process.env.CLOUDINARY_URL);
      if (u.protocol === "cloudinary:") { cloudName = u.hostname; apiKey = decodeURIComponent(u.username); apiSecret = decodeURIComponent(u.password); }
    } catch { /* malformed: treated as not configured */ }
  }
  return cloudName && apiKey && apiSecret ? { cloudName, apiKey, apiSecret } : undefined;
}
export function creds() {
  const c = readCreds();
  if (!c) throw new HttpError(503, "Image uploads are not configured");
  return c;
}
export const isConfigured = () => !!readCreds();

export function signUpload() {
  const { cloudName, apiKey, apiSecret } = creds();
  const timestamp = Math.floor(Date.now() / 1000);
  // Every param signed here must be sent unchanged with the upload; the browser can't change the folder or the allowed formats.
  const params = { allowed_formats: ALLOWED_FORMATS, folder: UPLOAD_FOLDER, timestamp };
  return { cloudName, apiKey, timestamp, folder: UPLOAD_FOLDER, allowedFormats: ALLOWED_FORMATS, signature: cloudinary.utils.api_sign_request(params, apiSecret), uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/image/upload` };
}

// A stored image URL that claims a public_id must really live in OUR cloud, in our folder.
export const isOurAsset = (url: string, publicId: string) => {
  try { const { cloudName } = creds(); return url.startsWith(`https://res.cloudinary.com/${cloudName}/`) && url.includes(publicId); } catch { return false; }
};

type Destroyer = (publicId: string) => Promise<unknown>;
let destroyer: Destroyer | undefined;
export const setDestroyerForTests = (d: Destroyer | undefined) => { destroyer = d; };

// Best-effort: the database row is already gone, so a failed remote delete must not fail the request (it only leaves an orphan).
export async function destroyAsset(publicId: string | null | undefined): Promise<void> {
  if (!publicId || !PUBLIC_ID_PATTERN.test(publicId)) return;
  try {
    if (destroyer) return void (await destroyer(publicId));
    const { cloudName, apiKey, apiSecret } = creds();
    cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
    await cloudinary.uploader.destroy(publicId, { invalidate: true });
  } catch (e) {
    console.error(`could not delete Cloudinary asset ${publicId}:`, e instanceof Error ? e.message : e);
  }
}
