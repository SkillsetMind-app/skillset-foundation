import { NextResponse } from "next/server";

// Sink for Content-Security-Policy-Report-Only violations (next.config.ts points
// report-uri here). Browsers POST these unauthenticated, so there's no auth gate.
// We log directive + blocked URI — enough to learn the real policy before
// promoting the CSP to enforcing. ponytail: console only; wire to a durable sink
// (PostHog/DB) only if report volume ever justifies it.

export const runtime = "nodejs";

export async function POST(request: Request) {
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
