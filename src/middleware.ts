import { NextResponse, type NextRequest } from "next/server";

import { notifyOps } from "@/lib/ops/alert";

/**
 * Country filter on the doors that matter.
 *
 * What this buys: most credential stuffing and card testing is opportunistic
 * volume from a handful of hosting regions, and it does not bother to look
 * local. Refusing it at the edge removes the majority of that noise for free.
 *
 * What it does NOT buy, and nobody should believe otherwise: anyone determined
 * enough to use a US VPN or a US cloud instance arrives as a US visitor and
 * walks straight through. This is a noise filter, never a wall, and it must not
 * be the reason another control is skipped.
 *
 * Three decisions worth keeping:
 *
 *  - **Sensitive paths only.** The marketing site, the catalogue and the
 *    classroom stay open to the world. Blocking those would cost search traffic
 *    and protect nothing — a visitor reading the homepage cannot do harm.
 *  - **Fails OPEN.** No country header (local dev, an unknown network, a header
 *    Vercel did not populate) means allow. A geo filter that blocks whenever it
 *    cannot tell takes the whole platform down the first time the signal
 *    hiccups, which is a far worse outcome than the traffic it was filtering.
 *  - **The list is an env var.** A hardcoded list that locks the founder out
 *    would need a code change and a deploy to undo — at exactly the moment
 *    nobody can get in to ship it.
 */

// Stripe's webhooks arrive from Stripe's own infrastructure and the cron routes
// from Vercel's; neither is a person and neither has a meaningful country.
// Filtering them would break payments and scheduled work, so they are absent
// from the matcher below by design, not by omission.
export const config = {
  matcher: [
    "/auth",
    "/login",
    "/signup",
    "/api/auth/:path*",
    "/api/payments/:path*",
  ],
};

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

export function middleware(request: NextRequest) {
  // Empty when the filter is switched off entirely, which is a legitimate
  // configuration and must mean "allow everything" rather than "allow nothing".
  const allowed = allowedCountries();
  if (allowed.size === 0) {
    return NextResponse.next();
  }

  const country = request.headers.get("x-vercel-ip-country")?.toUpperCase();
  if (!country || allowed.has(country)) {
    return NextResponse.next();
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
