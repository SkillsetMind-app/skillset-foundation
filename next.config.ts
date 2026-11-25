import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  // Suppress the `X-Powered-By: Next.js` response header. It is pure stack
  // fingerprinting with no functional value and, on a public repo, points
  // scanners straight at the framework version. (Security audit 2026-06-18.)
  poweredByHeader: false,
  // AI captions: the route calls the ffmpeg binary (src/lib/ai/audio.ts). The
  // package only exports the PATH to the binary, so file tracing does not see
  // it on its own: it stays out of the bundle and is added by hand to this
  // route's function.
  serverExternalPackages: ["ffmpeg-static"],
  outputFileTracingIncludes: {
    "/api/teach/ai": ["./node_modules/ffmpeg-static/ffmpeg"],
  },
  images: {
    qualities: [75, 90, 95],
    // AVIF first, WebP as fallback: the portraits are served from their
    // high-resolution originals, so the optimizer picks the format per browser.
    formats: ["image/avif", "image/webp"],
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
  // protection. The CSP itself is enforcing and per-request (nonce,
  // strict-dynamic): it is built in src/lib/security/csp.ts and set by
  // src/proxy.ts as Content-Security-Policy, with violations sent to
  // /api/csp-report.
  // /lp is the short shortcut to the Founding Creator landing, which lives on
  // its own domain (lp.skillsetmind.com, Vercel project skillsetmind-landing).
  // It is a redirect, not a rewrite: the landing is static HTML that calls
  // support.js and uploads/ by RELATIVE path, so serving it under /lp would
  // resolve the assets at /support.js and break everything. Forcing a trailing
  // slash would fight Next's trailingSlash:false. The fragment (#pricing,
  // #start...) is preserved by the browser on the redirect. ponytail: one line
  // instead of a proxy.
  async redirects() {
    return [
      // Redirects run before proxy.ts. Let entry aliases reach its method gate
      // instead of forwarding a POST body to the landing site with this 307.
      {
        source: "/lp",
        destination: "https://lp.skillsetmind.com",
        permanent: false,
        missing: [{ type: "host", value: "(app|consumer|pay)\\.skillsetmind\\.com\\.?" }],
      },
      {
        source: "/lp/:path*",
        destination: "https://lp.skillsetmind.com/:path*",
        permanent: false,
        missing: [{ type: "host", value: "(app|consumer|pay)\\.skillsetmind\\.com\\.?" }],
      },
    ];
  },
  // `/@username` is the teacher's bio link. In the App Router a folder that
  // starts with @ is a parallel route slot, so the address lives here: a
  // rewrite (the visitor's URL does not change) to the profile page, which
  // reads the @ from the parameter. Nothing needs to be reserved: no route on
  // the site starts with @.
  async rewrites() {
    return [{ source: "/@:username", destination: "/instructors/@:username" }];
  },
  async headers() {
    return [
      {
        // Broad HSTS (2 years, subdomains, preload) ONLY on the platform's own
        // host. Since we started serving teacher domains (PR #105), the old
        // rule on `/:path*` with no host condition told the browser to force
        // HTTPS for 2 years on ALL subdomains of a domain that is not ours, and
        // enrolled its name in the preload list. That is an effect on a third
        // party's property that the domain owner did not ask for and cannot
        // undo quickly (leaving the preload list takes months).
        source: "/:path*",
        has: [{ type: "host", value: "(www\\.)?skillsetmind\\.com" }],
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
      {
        // All other hosts (the teacher's domain): still forces HTTPS, but only
        // for the exact host, with no say over its subdomains and no preload.
        source: "/:path*",
        missing: [{ type: "host", value: "(www\\.)?skillsetmind\\.com" }],
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
        ],
      },
      {
        source: "/:path*",
        headers: [
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
          // The enforcing, nonce-based CSP is attached per request by proxy.ts.
        ],
      },
    ];
  },
};

export default nextConfig;
