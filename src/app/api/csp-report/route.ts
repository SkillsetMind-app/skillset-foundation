import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { allowByIp, allowByKey } from "@/lib/supabase/rate-limit";
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

// Only these directives can mean "someone is running code or moving data the
// page did not ask for": injected scripts, exfiltration channels, hostile
// frames, clickjacking. A blocked font, stylesheet or image is a broken page
// at worst — the platform log keeps it, the phone does not need to buzz.
// Twelve identical messages for a font a browser extension tried to load is
// how a security channel gets muted, and a muted channel is the real risk.
const ALERT_DIRECTIVES = new Set([
  "script-src",
  "script-src-elem",
  "script-src-attr",
  "connect-src",
  "frame-src",
  "child-src",
  "worker-src",
  "object-src",
  "base-uri",
  "form-action",
  "frame-ancestors",
]);

// One alert per (directive, blocked origin) per hour, counted in the database
// rather than in this instance's memory: a page load fans four reports over
// four serverless instances, and an in-process throttle lets all four through
// because each instance is seeing its "first" one.
const ALERT_WINDOW_MS = 60 * 60_000;

/** The directive name alone: "script-src 'self' https://x" -> "script-src". */
function directiveOf(report: Record<string, unknown>): string {
  const raw = report["effective-directive"] ?? report["violated-directive"];
  if (typeof raw !== "string") return "unknown";
  const first = raw.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return first ? first.slice(0, 40) : "unknown";
}

/** Fixed-width key so a flood of invented origins cannot grow the limiter table's key space. */
function alertKey(directive: string, blocked: string): string {
  const digest = createHash("sha256").update(`${directive}\n${blocked}`).digest("hex");
  return `csp_alert_${digest.slice(0, 24)}`;
}

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
    const directive = directiveOf(report);
    // Origin only, never the raw value. "Which host got blocked" is the whole
    // question a CSP alert has to answer, and a blocked-uri can be a signed
    // URL, a one-time token or a private path — none of which belong in an
    // alert that fans out to chat.
    const blocked = originOf(report["blocked-uri"]) ?? "unknown";
    console.warn("[csp-report]", {
      directive,
      blocked,
      // Route only. A full document-uri carries the customer's ids and one-time
      // query parameters straight into the platform log, which is retained and
      // read by more people than the ops channel is.
      document: routeOf(report["document-uri"]),
    });
    // Noise stops here: the log above is the record, the channel is for signal.
    if (!ALERT_DIRECTIVES.has(directive)) {
      return new NextResponse(null, { status: 204 });
    }
    // allowByKey fails open. If the limiter is unreachable the alert still goes
    // out — a duplicate message is cheap, a swallowed injection report is not.
    if (!(await allowByKey(alertKey(directive, blocked), 1, ALERT_WINDOW_MS))) {
      return new NextResponse(null, { status: 204 });
    }
    notifyOps({
      event: "security.csp_violation",
      severity: "warn",
      summary: "The browser blocked a resource that violated the enforced CSP.",
      context: { directive, blocked },
    });
  } catch {
    // Malformed or empty beacon — ignore, never error a violation report.
  }
  return new NextResponse(null, { status: 204 });
}
