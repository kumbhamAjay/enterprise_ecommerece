import { NextResponse, type NextRequest } from "next/server";

// Browser calls /api/* on the same origin; this forwards them to the Express API.
// The address is read at REQUEST time, so one built image works in every environment. (A `rewrites()` entry in next.config.ts is
// frozen at BUILD time: a wrong or missing value at build means every /api call fails until you rebuild.)
// Accepts "http://host:port" or a bare "host:port" (what Render's private network provides).
export function proxy(req: NextRequest) {
  const base = (process.env.API_URL ?? "http://127.0.0.1:5000").replace(/^(?!https?:\/\/)/, "http://");
  return NextResponse.rewrite(new URL(req.nextUrl.pathname + req.nextUrl.search, base));
}

export const config = { matcher: "/api/:path*" };
