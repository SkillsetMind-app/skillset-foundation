import { NextResponse, type NextRequest } from "next/server";

import { createServerClient } from "@supabase/ssr";

import { notifyOps } from "@/lib/ops/alert";
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

const DEFAULT_ALLOWED = "US,BR";

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
export async function proxy(request: NextRequest) {
  // Before any of the session work: refreshing a token for a request we are
  // about to refuse is wasted round trips against Supabase.
  const refused = refusedForCountry(request);
  if (refused) {
    return refused;
  }

  let response = NextResponse.next({ request });

  const config = getSupabaseClientConfig();
  if (!config) {
    // Supabase not configured yet — pass through untouched.
    return response;
  }

  const supabase = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Touch the session so an expiring token gets rotated into the response
  // cookies. Do NOT gate/redirect on identity here — route-level guards own
  // authorization. The country check above is not an exception to that: it
  // refuses a connection, and knows nothing about who is making it.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    // Everything except Next internals and static assets.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
