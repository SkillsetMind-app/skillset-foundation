import { NextResponse } from "next/server";

import { allowByIp } from "@/lib/supabase/rate-limit";
import { notifyOps } from "@/lib/ops/alert";

// Sink for enforcing Content-Security-Policy violations (security/csp.ts points
// report-uri here). Browsers POST these unauthenticated, so there is no auth gate.
// Reports are bounded, sanitized, logged, and forwarded to the throttled durable
// ops channel so a real attack does not disappear with a serverless instance.

export const runtime = "nodejs";

// A real browser sends a burst on page load, then goes quiet. 60/min per IP
// leaves honest reporting untouched and caps anyone flooding fake beacons to
// burn invocations or drown the real signal.
const REPORTS_PER_MINUTE = 60;
const MAX_REPORT_BYTES = 32 * 1024;

async function readBoundedBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_REPORT_BYTES) return null;
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_REPORT_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

export async function POST(request: Request) {
  // Over the limit: still answer 204. A violation report has no error channel,
  // and telling a flooder they hit a limit only helps them tune the flood.
  if (!(await allowByIp(request, "csp", REPORTS_PER_MINUTE, 60_000))) {
    return new NextResponse(null, { status: 204 });
  }

  try {
    const raw = await readBoundedBody(request);
    if (raw === null) return new NextResponse(null, { status: 413 });
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // report-uri wraps the payload in { "csp-report": {...} }; report-to sends the
    // fields at top level. Accept either.
    const report = (parsed["csp-report"] as Record<string, unknown> | undefined) ?? parsed;
    const safe = (value: unknown) =>
      typeof value === "string" ? value.replace(/[\r\n]/g, " ").slice(0, 500) : undefined;
    console.warn("[csp-report]", {
      directive: safe(report["violated-directive"] ?? report["effective-directive"]),
      blocked: safe(report["blocked-uri"]),
      document: safe(report["document-uri"]),
    });
    notifyOps({
      event: "security.csp_violation",
      severity: "warn",
      summary: "The browser blocked a resource that violated the enforced CSP.",
      context: {
        directive: safe(report["violated-directive"] ?? report["effective-directive"]) ?? "unknown",
        // Do not send document URLs: they can contain customer identifiers or
        // one-time query parameters. Origin-level blocked data is sufficient.
        blocked: safe(report["blocked-uri"]) ?? "unknown",
      },
    });
  } catch {
    // Malformed or empty beacon — ignore, never error a violation report.
  }
  return new NextResponse(null, { status: 204 });
}
