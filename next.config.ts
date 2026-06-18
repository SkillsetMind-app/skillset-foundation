import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  // Suppress the `X-Powered-By: Next.js` response header. It is pure stack
  // fingerprinting with no functional value and, on a public repo, points
  // scanners straight at the framework version. (Security audit 2026-06-18.)
  poweredByHeader: false,
  images: {
    // Covers/avatars are only ever written as Firebase Storage download URLs
    // (course-assets.ts) or Google account photos — keep the allowlist tight.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "firebasestorage.googleapis.com",
      },
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
    ],
  },
};

export default nextConfig;
