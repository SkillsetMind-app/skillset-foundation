/** Per-request enforcing CSP. A nonce lets Next's bootstrap and our tiny theme
 * initializer run without opening every inline script or eval to an attacker. */
export function buildContentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "form-action 'self' https://checkout.stripe.com",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://connect-js.stripe.com https://js.stripe.com https://us.i.posthog.com https://us-assets.i.posthog.com https://challenges.cloudflare.com https://va.vercel-scripts.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://ijtikldtjvsbtwszokvs.supabase.co wss://ijtikldtjvsbtwszokvs.supabase.co https://api.stripe.com https://api.pwnedpasswords.com https://us.i.posthog.com https://us-assets.i.posthog.com https://va.vercel-scripts.com https://vitals.vercel-insights.com https://video.bunnycdn.com",
    "frame-src https://connect-js.stripe.com https://js.stripe.com https://hooks.stripe.com https://iframe.mediadelivery.net https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com https://accounts.google.com https://challenges.cloudflare.com",
    "media-src 'self' blob: https://ijtikldtjvsbtwszokvs.supabase.co https://iframe.mediadelivery.net",
    "upgrade-insecure-requests",
    "report-uri /api/csp-report",
  ].join("; ");
}
