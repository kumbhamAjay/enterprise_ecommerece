// Server Components talk to the API directly (absolute URL) and cache for `revalidate` seconds.
const API_URL = process.env.API_URL ?? "http://127.0.0.1:5000";

export async function serverGet<T>(path: string, revalidate = 60): Promise<T | null> {
  try {
    const res = await fetch(`${API_URL}${path}`, { next: { revalidate } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null; // API down: pages render an empty state instead of crashing
  }
}
