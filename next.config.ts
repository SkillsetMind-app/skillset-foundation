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
  // protection. A strict enforcing CSP is still a founder follow-up (it must be
  // tuned against Stripe.js, PostHog, Supabase, Google OAuth, and the
  // Bunny/YouTube/Vimeo iframes); until then we ship it REPORT-ONLY (below), so
  // violations are observed without any risk of breaking the site.
  // /lp e o atalho curto para a landing de Founding Creator, que vive em seu
  // proprio dominio (lp.skillsetmind.com, projeto Vercel skillsetmind-landing).
  // E redirect, nao rewrite: a landing e HTML estatico que chama support.js e
  // uploads/ por caminho RELATIVO, entao servi-la sob /lp resolveria os assets
  // em /support.js e quebraria tudo. Forcar barra no fim brigaria com o
  // trailingSlash:false do Next. O fragmento (#pricing, #start...) e preservado
  // pelo navegador no redirect. ponytail: uma linha em vez de um proxy.
  async redirects() {
    return [
      { source: "/lp", destination: "https://lp.skillsetmind.com", permanent: false },
      { source: "/lp/:path*", destination: "https://lp.skillsetmind.com/:path*", permanent: false },
    ];
  },
  async headers() {
    return [
      {
        // HSTS abrangente (2 anos, subdomínios, preload) SÓ no host da própria
        // plataforma. Desde que servimos domínios de professor (PR #105), a
        // regra antiga em `/:path*` sem condição de host mandava o navegador
        // forçar HTTPS por 2 anos em TODOS os subdomínios de um domínio que não
        // é nosso, e inscrevia o nome dele na lista de preload — um efeito
        // sobre propriedade de terceiro que o dono não pediu e não consegue
        // desfazer rápido (sair da preload leva meses).
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
        // Demais hosts (domínio do professor): ainda força HTTPS, mas fala só
        // pelo host exato — sem falar pelos subdomínios dele e sem preload.
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
