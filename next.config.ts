import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native / Node-only packages stay out of the bundle.
  serverExternalPackages: ["@libsql/client", "@react-pdf/renderer"],
  poweredByHeader: false,
  // Pin the workspace root (a stray lockfile higher up the tree would otherwise be picked).
  turbopack: { root: import.meta.dirname },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
  experimental: {
    serverActions: { bodySizeLimit: "512kb" },
  },
};

export default nextConfig;
