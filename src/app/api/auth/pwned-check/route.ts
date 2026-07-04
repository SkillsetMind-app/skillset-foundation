import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

// Server-side proxy for the HaveIBeenPwned "Pwned Passwords" range API. The
// browser sends ONLY the first 5 hex chars of a password's SHA-1 hash
// (k-anonymity) — never the password. We proxy so the client doesn't depend on
// HIBP's CORS and so lookups fail-open uniformly. `Add-Padding: true` obscures
// the real bucket size for extra privacy.
//
// SSRF-safe: `prefix` is constrained to exactly 5 hex chars, so the upstream URL
// can only ever be the HIBP range path — no user-controlled host or path.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HIBP_TIMEOUT_MS = 3000;
const PREFIX_RE = /^[0-9A-Fa-f]{5}$/;
// Per-IP ceiling: a password field fires a handful of debounced checks per
// signup, so 100/min is generous for real users while capping anyone farming
// this as a free HIBP proxy or hammering it. Edge-cached hits (see cache-control
// below) never reach here, so this only counts cache misses.
const RATE_LIMIT_PER_MINUTE = 100;

function rateLimitKeyFromIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  return `pwned_${createHash("sha256").update(ip).digest("hex").slice(0, 24)}`;
}

export async function GET(request: Request) {
  const prefix = new URL(request.url).searchParams.get("prefix") ?? "";
  if (!PREFIX_RE.test(prefix)) {
    return NextResponse.json({ error: "Invalid prefix." }, { status: 400 });
  }

  // Fail-open rate limit: a breach returns 429, but a limiter outage must never
  // block the pwned check — the whole route is best-effort auth assist.
  const supabase = await createSupabaseServerClient();
  const { error: rlError } = await supabase.rpc("enforce_rate_limit", {
    p_key: rateLimitKeyFromIp(request),
    p_limit: RATE_LIMIT_PER_MINUTE,
    p_window_ms: 60_000,
  });
  if (rlError?.message?.includes("RATE_LIMIT")) {
    return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HIBP_TIMEOUT_MS);
  try {
    const upstream = await fetch(
      `https://api.pwnedpasswords.com/range/${prefix.toUpperCase()}`,
      {
        headers: { "Add-Padding": "true", "User-Agent": "skillset-pwned-check" },
        signal: controller.signal,
      },
    );
    // Fail-open: an empty body makes the client treat the password as not-breached.
    if (!upstream.ok) {
      return new NextResponse("", { status: 200 });
    }
    const body = await upstream.text();
    return new NextResponse(body, {
      status: 200,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        // Same prefix -> same corpus for a while; let the edge cache it.
        "cache-control": "public, max-age=3600",
      },
    });
  } catch {
    return new NextResponse("", { status: 200 }); // fail-open on timeout/network
  } finally {
    clearTimeout(timer);
  }
}
