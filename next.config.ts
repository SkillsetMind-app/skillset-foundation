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
    // Covers/avatars are served from Supabase Storage public objects
    // (course-assets.ts) or Google account photos — keep the allowlist tight.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "ijtikldtjvsbtwszokvs.supabase.co",
        pathname: "/storage/v1/object/**",
      },
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
    ],
  },
  // Baseline security response headers on every route. The single most common
  // gap in AI-built SaaS (2026 vibe-coded audits): no clickjacking/HSTS/sniff
  // protection. Deliberately NOT a Content-Security-Policy here — a strict CSP
  // must be tuned against Stripe.js, PostHog, Supabase, Google OAuth, and the
  // Bunny/YouTube/Vimeo iframes, and adding one blind would break the site.
  // (Founder follow-up: add a tested CSP + report-only rollout.)
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Force HTTPS for 2 years incl. subdomains; eligible for preload list.
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          // Our pages may only be framed by ourselves (anti-clickjacking). Does
          // NOT affect us embedding YouTube/Vimeo/Bunny — that is the reverse.
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          // Block MIME-sniffing (drive-by content-type confusion).
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Never leak full path/query to third parties on cross-origin nav.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Deny powerful capabilities the platform never uses. Fullscreen and
          // autoplay are left untouched so the video players keep working.
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
