// Browser-side API client. Access token lives in memory; refresh token in localStorage.
// ponytail: localStorage is XSS-readable; move the refresh token to an httpOnly cookie via a Next route handler for production.

export class ApiError extends Error {
  constructor(public status: number, message: string, public fields: Record<string, string> = {}) {
    super(message);
  }
}

const RT_KEY = "shopeasy.rt";
let accessToken: string | null = null;
let inflight: Promise<boolean> | null = null;

export const hasStoredSession = () => typeof window !== "undefined" && !!localStorage.getItem(RT_KEY);

export function setTokens(t: { accessToken: string; refreshToken: string }) {
  accessToken = t.accessToken;
  localStorage.setItem(RT_KEY, t.refreshToken);
}
export function clearTokens() {
  accessToken = null;
  localStorage.removeItem(RT_KEY);
}
export const getRefreshToken = () => localStorage.getItem(RT_KEY);

async function doRefresh(): Promise<boolean> {
  const rt = localStorage.getItem(RT_KEY); // read inside the lock: another tab may have rotated it
  if (!rt) return false;
  const res = await fetch("/api/auth/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: rt }),
  });
  if (!res.ok) {
    clearTokens();
    return false;
  }
  setTokens((await res.json()).data);
  return true;
}

// Rotation makes refresh tokens single-use, so concurrent refreshes (parallel requests,
// StrictMode double effects, other tabs) must be serialized or reuse-detection logs everyone out.
export function refreshSession(): Promise<boolean> {
  if (!inflight) {
    const run: Promise<boolean> = navigator.locks ? (navigator.locks.request("shopeasy-refresh", doRefresh) as unknown as Promise<boolean>) : doRefresh(); // the DOM typing double-wraps; at runtime the promise is flattened
    inflight = run.finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

type Opts = { method?: string; body?: unknown; auth?: boolean; headers?: Record<string, string> };

async function request(path: string, { method = "GET", body, auth = true, headers }: Opts = {}, retried = false): Promise<any> {
  const res = await fetch(path, {
    method,
    headers: { ...(body !== undefined && { "content-type": "application/json" }), ...(auth && accessToken && { authorization: `Bearer ${accessToken}` }), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && auth && !retried && hasStoredSession() && (await refreshSession())) {
    return request(path, { method, body, auth, headers }, true);
  }
  if (res.status === 204) return undefined;

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const fields: Record<string, string> = {};
    for (const e of json.errors ?? []) fields[e.field] ??= e.message;
    throw new ApiError(res.status, json.message ?? (json.errors ? "Please check the highlighted fields" : "Something went wrong"), fields);
  }
  return json;
}

export const api = {
  get: <T>(path: string): Promise<T> => request(path).then((j) => j.data),
  page: <T>(path: string): Promise<T> => request(path), // full body, for { data, meta }
  post: <T = void>(path: string, body?: unknown, auth = true, headers?: Record<string, string>): Promise<T> => request(path, { method: "POST", body: body ?? {}, auth, headers }).then((j) => j?.data),
  patch: <T>(path: string, body: unknown): Promise<T> => request(path, { method: "PATCH", body }).then((j) => j.data),
  put: <T>(path: string, body: unknown): Promise<T> => request(path, { method: "PUT", body }).then((j) => j.data),
  del: (path: string): Promise<void> => request(path, { method: "DELETE" }),
  delData: <T>(path: string): Promise<T> => request(path, { method: "DELETE" }).then((j) => j.data), // DELETE that returns the updated resource
};
