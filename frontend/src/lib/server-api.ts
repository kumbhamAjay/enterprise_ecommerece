// Server Components talk to the API directly (absolute URL) and cache for `revalidate` seconds.
// Accepts "http://host:port" or a bare "host:port" (what Render's private network gives us)
const API_URL = (process.env.API_URL ?? "http://127.0.0.1:5000").replace(/^(?!https?:\/\/)/, "http://");

export async function serverGet<T>(path: string, revalidate = 60): Promise<T | null> {
  try {
    const res = await fetch(`${API_URL}${path}`, { next: { revalidate } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null; // API down: pages render an empty state instead of crashing
  }
}
