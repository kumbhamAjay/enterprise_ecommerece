import type { NextConfig } from "next";

// Accepts "http://host:port" or a bare "host:port" (what Render's private network gives us)
const API_URL = (process.env.API_URL ?? "http://127.0.0.1:5000").replace(/^(?!https?:\/\/)/, "http://");

const nextConfig: NextConfig = {
  output: "standalone", // minimal self-contained server for the Docker image
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
