// Cloudinary serves resized, modern-format (WebP/AVIF) images straight from the URL. Insert a transformation so a 120px
// thumbnail never downloads a 4000px original. Non-Cloudinary URLs (imports, pasted links) pass through untouched.
export function imgUrl(url: string | null, width = 800): string | null {
  if (!url || !url.includes("res.cloudinary.com") || !url.includes("/upload/")) return url;
  if (/\/upload\/[a-z]{1,3}_[^/]*\//.test(url)) return url; // already has a transformation
  return url.replace("/upload/", `/upload/f_auto,q_auto,c_limit,w_${width}/`);
}
