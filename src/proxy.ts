import { NextResponse, type NextRequest, type ProxyConfig } from "next/server";

import { createServerClient } from "@supabase/ssr";

import {
  decideHostRoute,
  isPlatformHost,
  normaliseHostHeader,
} from "@/domain/host-routing";
import { resolveHostToUid } from "@/lib/domains/resolve-host";
import { notifyOps } from "@/lib/ops/alert";
import { buildContentSecurityPolicy } from "@/lib/security/csp";
import { getSupabaseClientConfig } from "@/lib/supabase/config";

/**
 * Country filter on the doors that matter.
 *
 * What this buys: most credential stuffing and card testing is opportunistic
 * volume from a handful of hosting regions, and it does not bother to look
 * local. Refusing it here removes the majority of that noise before it reaches
 * a function.
 *
 * What it does NOT buy, and nobody should believe otherwise: anyone determined
 * enough to use a US VPN or a US cloud instance arrives as a US visitor and
 * walks straight through. This is a noise filter, never a wall, and it must not
 * be the reason another control is skipped.
 *
 * This is the one gate that belongs in this file. The rule below about leaving
 * authorization to route-level guards still holds: a country is not an identity
 * and this decides nothing about who anyone is. It refuses a connection before
 * any session exists, which is precisely why it cannot live in a route guard.
 */

// Sensitive doors only. The marketing site, the catalogue and the classroom stay
// open to the world: blocking those would cost search traffic and protect
// nothing, since a visitor reading the homepage cannot do harm.
//
// The Stripe webhook and the cron routes are absent by design, not by omission.
// Neither is a person, neither has a meaningful country, and filtering them
// would break payments and scheduled work.
const GUARDED_EXACT = new Set(["/auth", "/login", "/signup"]);
const GUARDED_PREFIXES = ["/api/auth/", "/api/payments/"];

// /auth/callback and /auth/confirm are deliberately NOT guarded: they are
// return legs of a flow that already passed the check, and a link opened from
// an email client on some other network must still complete.
function isGuardedPath(pathname: string): boolean {
  return (
    GUARDED_EXACT.has(pathname) ||
    GUARDED_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

// Off unless someone turns it on. Patrick decided the platform should not
// be limited by country, so the filter ships dormant rather than being
// deleted: the code, the tests and the escape hatch stay, and switching it
// on later is one environment variable instead of a new pull request.
const DEFAULT_ALLOWED = "";

function allowedCountries(): ReadonlySet<string> {
  const raw = process.env.GEO_ALLOWED_COUNTRIES ?? DEFAULT_ALLOWED;
  return new Set(
    raw
      .split(",")
      .map((code) => code.trim().toUpperCase())
      .filter(Boolean),
  );
}

function refusedForCountry(request: NextRequest): NextResponse | null {
  if (!isGuardedPath(request.nextUrl.pathname)) {
    return null;
  }

  // Empty means the filter is switched off, which is a legitimate configuration
  // and has to mean "allow everything" rather than "allow nothing".
  const allowed = allowedCountries();
  if (allowed.size === 0) {
    return null;
  }

  // Fails OPEN. No country header — local dev, an unknown network, a header the
  // platform did not populate — allows the request. A filter that blocks
  // whenever it cannot tell takes the whole platform down the first time the
  // signal hiccups, which is far worse than the traffic it was filtering.
  const country = request.headers.get("x-vercel-ip-country")?.toUpperCase();
  if (!country || allowed.has(country)) {
    return null;
  }

  notifyOps({
    event: "geo.blocked",
    severity: "warn",
    summary:
      "A sign-in, sign-up or payment request was refused because it came from outside the allowed countries.",
    context: { country, path: request.nextUrl.pathname },
  });

  // Plain 403 with no detail about the rule: an attacker learning exactly which
  // countries pass is a free hint about which exit node to buy next.
  return new NextResponse(
    "This service is not available from your location.",
    { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } },
  );
}

// Refreshes the Supabase auth session on every request (the token cookie is
// short-lived and would otherwise expire between renders), so Server Components
// and Route Handlers always read a valid session and auth.uid() drives RLS.
// This is the documented @supabase/ssr proxy pattern.
/**
 * Custom domain resolution. A teacher points their own hostname here and the
 * root of it serves their storefront.
 *
 * Ordering inside this function is load-bearing twice over:
 *
 * - AFTER the country filter, so a refused request never costs a lookup, and so
 *   the filter still reads the ORIGINAL pathname. Rewriting first would hand it
 *   `/instructors/<uid>` and `/login` on a teacher's domain would sail past a
 *   guard that was looking for `/login`.
 *
 * - BEFORE the session refresh, because a redirect away from this host makes the
 *   refresh pointless — the cookie belongs to an origin we are leaving.
 *
 * `isPlatformHost()` short-circuits ahead of everything, so ordinary traffic on
 * skillsetmind.com never touches the database.
 */
async function routedByHost(
  request: NextRequest,
  requestHeaders: Headers,
): Promise<NextResponse | null> {
  const hostname = normaliseHostHeader(request.headers.get("host"));
  if (!hostname) {
    return null;
  }

  const resolvedUid = isPlatformHost(hostname) ? null : await resolveHostToUid(hostname);
  const decision = decideHostRoute({
    hostname,
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
    method: request.method,
    resolvedUid,
  });

  switch (decision.kind) {
    case "method-not-allowed":
      return new NextResponse(null, { status: 405, headers: { Allow: "GET, HEAD" } });
    case "pass":
      return null;
    case "rewrite": {
      const url = request.nextUrl.clone();
      const [path, query] = decision.path.split("?");
      url.pathname = path;
      url.search = query ? `?${query}` : "";
      return NextResponse.rewrite(url, { request: { headers: requestHeaders } });
    }
    case "redirect":
      // 308 rather than 302: the move is permanent for this path on this host,
      // and 308 preserves the method so a POST to a form that moved does not
      // silently become a GET.
      return NextResponse.redirect(decision.url, decision.status ?? 308);
  }
}

export async function proxy(request: NextRequest) {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const csp = buildContentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // Next reads the request CSP to apply this nonce to its own bootstrap scripts.
  requestHeaders.set("content-security-policy", csp);
  const secure = (response: NextResponse) => {
    response.headers.set("Content-Security-Policy", csp);
    return response;
  };
  // Before any of the session work: refreshing a token for a request we are
  // about to refuse is wasted round trips against Supabase.
  const refused = refusedForCountry(request);
  if (refused) {
    return secure(refused);
  }

  const routed = await routedByHost(request, requestHeaders);
  if (routed) {
    return secure(routed);
  }

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const config = getSupabaseClientConfig();
  if (!config) {
    // Supabase not configured yet — pass through untouched.
    return secure(response);
  }

  const supabase = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headersToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request: { headers: requestHeaders } });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        for (const [name, value] of Object.entries(headersToSet)) {
          response.headers.set(name, value);
        }
      },
    },
  });

  // Touch the session so an expiring token gets rotated into the response
  // cookies. Do NOT gate/redirect on identity here — route-level guards own
  // authorization. The country check above is not an exception to that: it
  // refuses a connection, and knows nothing about who is making it.
  await supabase.auth.getUser();

  return secure(response);
}

export const config: ProxyConfig = {
  matcher: [
    // Entry aliases must reach the redirect/405 gate even for an API id ending
    // in .png, Next internals or assets. Keep literal values for Next's analyzer.
    {
      source: "/:path*",
      has: [{ type: "host", value: "(app|consumer|pay)\\.skillsetmind\\.com\\.?" }],
    },
    // Preserve the existing exclusions on all other hosts.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
