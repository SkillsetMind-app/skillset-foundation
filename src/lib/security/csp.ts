/**
 * The Supabase origins of THIS deployment, read from the configured URL.
 *
 * These were written into the policy by hand until 2026-09-04. A pinned host in
 * an enforcing policy is wrong in both directions: a preview, a staging env or a
 * disaster-recovery project pointing at a different Supabase gets every REST
 * call, Realtime socket and media fetch blocked by the browser, while a project
 * migration leaves the OLD host still allowed — the opposite of what an
 * allowlist exists to do. Deriving it means the policy follows the deployment.
 *
 * No hardcoded fallback on purpose: if NEXT_PUBLIC_SUPABASE_URL is missing the
 * Supabase client cannot initialize either, so the app is already down. A
 * fallback would only make the policy quietly trust a host this deployment does
 * not use.
 */
function supabaseOrigins(): string[] {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!raw) return [];
  try {
    const { origin, host, protocol } = new URL(raw);
    // Plain http only for `supabase start` locally. Allowing it in production
    // would undo the upgrade-insecure-requests directive below.
    if (protocol !== "https:" && process.env.NODE_ENV === "production") return [];
    return [origin, `${protocol === "https:" ? "wss" : "ws"}://${host}`];
  } catch {
    return [];
  }
}

/** Per-request enforcing CSP. A nonce lets Next's bootstrap and our tiny theme
 * initializer run without opening every inline script or eval to an attacker. */
export function buildContentSecurityPolicy(nonce: string): string {
  const supabase = supabaseOrigins();
  const supabaseConnect = supabase.length ? ` ${supabase.join(" ")}` : "";
  // Protected PDFs use iframes; videos use media elements. Both need the HTTP
  // Storage origin, while the Realtime socket belongs only in connect-src.
  const supabaseAssetOrigin = supabase[0] ? ` ${supabase[0]}` : "";
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "form-action 'self' https://checkout.stripe.com",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://checkout.stripe.com https://connect-js.stripe.com https://js.stripe.com https://us.i.posthog.com https://us-assets.i.posthog.com https://challenges.cloudflare.com https://va.vercel-scripts.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self'${supabaseConnect} https://checkout.stripe.com https://api.stripe.com https://api.pwnedpasswords.com https://us.i.posthog.com https://us-assets.i.posthog.com https://va.vercel-scripts.com https://vitals.vercel-insights.com https://video.bunnycdn.com`,
    `frame-src${supabaseAssetOrigin} https://checkout.stripe.com https://connect-js.stripe.com https://js.stripe.com https://hooks.stripe.com https://iframe.mediadelivery.net https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com https://accounts.google.com https://challenges.cloudflare.com`,
    `media-src 'self' blob:${supabaseAssetOrigin} https://iframe.mediadelivery.net`,
    "upgrade-insecure-requests",
    "report-uri /api/csp-report",
  ].join("; ");
}
