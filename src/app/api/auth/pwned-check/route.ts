import { NextResponse } from "next/server";

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

export async function GET(request: Request) {
  const prefix = new URL(request.url).searchParams.get("prefix") ?? "";
  if (!PREFIX_RE.test(prefix)) {
    return NextResponse.json({ error: "Invalid prefix." }, { status: 400 });
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
