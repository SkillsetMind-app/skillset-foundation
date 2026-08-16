import { NextResponse } from "next/server";

import { allowByIp } from "@/lib/supabase/rate-limit";

// Sink for Content-Security-Policy-Report-Only violations (next.config.ts points
// report-uri here). Browsers POST these unauthenticated, so there's no auth gate.
// We log directive + blocked URI — enough to learn the real policy before
// promoting the CSP to enforcing. ponytail: console only; wire to a durable sink
// (PostHog/DB) only if report volume ever justifies it.

export const runtime = "nodejs";

// A real browser sends a burst on page load, then goes quiet. 60/min per IP
// leaves honest reporting untouched and caps anyone flooding fake beacons to
// burn invocations or drown the real signal.
const REPORTS_PER_MINUTE = 60;

export async function POST(request: Request) {
  // Over the limit: still answer 204. A violation report has no error channel,
  // and telling a flooder they hit a limit only helps them tune the flood.
  if (!(await allowByIp(request, "csp", REPORTS_PER_MINUTE, 60_000))) {
    return new NextResponse(null, { status: 204 });
  }

  try {
    const parsed = JSON.parse(await request.text()) as Record<string, unknown>;
    // report-uri wraps the payload in { "csp-report": {...} }; report-to sends the
    // fields at top level. Accept either.
    const report = (parsed["csp-report"] as Record<string, unknown> | undefined) ?? parsed;
    console.warn("[csp-report]", {
      directive: report["violated-directive"] ?? report["effective-directive"],
      blocked: report["blocked-uri"],
      document: report["document-uri"],
    });
  } catch {
    // Malformed or empty beacon — ignore, never error a violation report.
  }
  return new NextResponse(null, { status: 204 });
}
