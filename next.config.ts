import type { NextConfig } from "next";

// Report-only CSP: browsers evaluate it and POST any violation to
// /api/csp-report, but NOTHING is ever blocked. This is the observe phase of a
// CSP rollout — it lets prod traffic reveal the true directive set (Stripe.js,
// Supabase, Google OAuth, PostHog, the Bunny/YouTube/Vimeo players) before we
// promote to an enforcing `Content-Security-Policy`. img-src stays broad
// (https:) because course thumbnails come from many hosts; tighten before
// enforcing. ponytail: report-uri (not report-to) — still honored in report-only
// and one line; add report-to only if a target browser drops report-uri.
export const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://connect-js.stripe.com https://js.stripe.com https://us.i.posthog.com https://us-assets.i.posthog.com https://challenges.cloudflare.com https://va.vercel-scripts.com",
  "style-src 'self' 'unsafe-inline' 'sha256-0hAheEzaMe6uXIKV4EehS9pu1am1lj/KnnzrOYqckXk='",
  "img-src 'self' data: blob: https: https://*.stripe.com",
  "font-src 'self' data:",
  "connect-src 'self' https://ijtikldtjvsbtwszokvs.supabase.co wss://ijtikldtjvsbtwszokvs.supabase.co https://api.stripe.com https://api.pwnedpasswords.com https://us.i.posthog.com https://us-assets.i.posthog.com https://va.vercel-scripts.com https://vitals.vercel-insights.com",
  "frame-src https://connect-js.stripe.com https://js.stripe.com https://hooks.stripe.com https://iframe.mediadelivery.net https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com https://accounts.google.com https://challenges.cloudflare.com",
  "media-src 'self' blob: https://ijtikldtjvsbtwszokvs.supabase.co https://iframe.mediadelivery.net",
  "report-uri /api/csp-report",
].join("; ");

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
  // protection. A strict enforcing CSP is still a founder follow-up (it must be
  // tuned against Stripe.js, PostHog, Supabase, Google OAuth, and the
  // Bunny/YouTube/Vimeo iframes); until then we ship it REPORT-ONLY (below), so
  // violations are observed without any risk of breaking the site.
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
          // Observe-only: reports violations to /api/csp-report, blocks nothing.
          { key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY },
        ],
      },
    ];
  },
};

export default nextConfig;
