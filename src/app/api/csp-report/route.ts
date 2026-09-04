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

/**
 * The origin a blocked URL came from, and nothing else.
 *
 * A blocked-uri is attacker- and browser-shaped: it can be a signed asset URL,
 * a password-reset link the page tried to prefetch, or a path that names the
 * customer. The alert only ever needs the HOST — "who did the page try to
 * reach that the policy forbids" — so the query, the fragment and the path are
 * dropped here rather than trusted to whoever reads the channel.
 *
 * The CSP spec also sends bare keywords ("inline", "eval", "self") and opaque
 * schemes; those are already origin-free, so they pass through as labels.
 */
function originOf(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const raw = value.trim();
  if (!raw) return undefined;
  if (/^(inline|eval|self|data|blob|wasm-eval|trusted-types-sink)$/i.test(raw)) {
    return raw.toLowerCase();
  }
  try {
    const url = new URL(raw);
    // data:/blob:/filesystem: have no meaningful host — the scheme IS the answer.
    if (!url.host) return `${url.protocol.replace(":", "")}:`;
    return url.origin.slice(0, 200);
  } catch {
    // Not a URL the platform can parse. Say so instead of forwarding the bytes.
    return "unparseable";
  }
}

/** Same idea for the page that reported: route, never the query string. */
function routeOf(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const raw = value.trim();
  if (!raw) return undefined;
  try {
    return new URL(raw).pathname.slice(0, 200);
  } catch {
    return "unparseable";
  }
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
      blocked: originOf(report["blocked-uri"]),
      // Route only. A full document-uri carries the customer's ids and one-time
      // query parameters straight into the platform log, which is retained and
      // read by more people than the ops channel is.
      document: routeOf(report["document-uri"]),
    });
    notifyOps({
      event: "security.csp_violation",
      severity: "warn",
      summary: "The browser blocked a resource that violated the enforced CSP.",
      context: {
        directive: safe(report["violated-directive"] ?? report["effective-directive"]) ?? "unknown",
        // Origin only, never the raw value. "Which host got blocked" is the whole
        // question a CSP alert has to answer, and a blocked-uri can be a signed
        // URL, a one-time token or a private path — none of which belong in an
        // alert that fans out to chat.
        blocked: originOf(report["blocked-uri"]) ?? "unknown",
      },
    });
  } catch {
    // Malformed or empty beacon — ignore, never error a violation report.
  }
  return new NextResponse(null, { status: 204 });
}
