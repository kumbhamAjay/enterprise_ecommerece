import type { NextConfig } from "next";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:5000";

const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // Browser calls /api/* on the same origin; Next forwards to the Express API (no CORS needed).
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
  },
};

export default nextConfig;
