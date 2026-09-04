import { createHmac, randomBytes } from "node:crypto";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export async function runRateLimit(key: string, limit: number, windowMs: number) {
  return getSupabaseAdminClient().rpc("enforce_rate_limit", {
    p_key: key,
    p_limit: limit,
    p_window_ms: windowMs,
  });
}

/**
 * Pepper of last resort, drawn once per process.
 *
 * It covers exactly one situation: production booted without RATE_LIMIT_PEPPER.
 * The choice there is between persisting a plain sha256 (which a four-billion
 * row lookup table turns back into the visitor's address in seconds) and losing
 * bucket continuity whenever the function recycles. Losing the bucket is cheap.
 * Storing an address dressed up as a hash is not, and it is the exact bug the
 * pepper was introduced to fix.
 *
 * Deliberately NOT the service-role key. That key's job is to bypass RLS; using
 * it here welds a public read path onto the platform's most privileged secret,
 * so rotating one silently resets the other and any leak of a derived value
 * becomes material for testing the real key.
 */
const fallbackPepper = randomBytes(32).toString("hex");
let warnedAboutMissingPepper = false;

/**
 * Rate-limit key for an UNAUTHENTICATED caller. The IP is hashed so the limiter
 * table never stores a raw address; 24 hex chars is plenty to keep buckets apart.
 *
 * Keyed with RATE_LIMIT_PEPPER. A plain sha256 of an IPv4 is one lookup table
 * away from the address, so the stored row would still be personal data in
 * disguise; with the pepper nobody without the server env can turn a row back
 * into a visitor.
 *
 * This function never throws. It is called on public read paths whose contract
 * is to fail OPEN, and a configuration error must not be the thing that takes
 * /api/csp-report, /api/auth/pwned-check and the public offer reads down.
 */
export function rateLimitKeyFromIp(request: Request, prefix: string): string {
  // Vercel supplies x-real-ip itself. Prefer that single trusted hop over the
  // client-shaped x-forwarded-for chain; deployments behind another proxy must
  // overwrite x-real-ip before forwarding to the app.
  const realIp = request.headers.get("x-real-ip")?.trim() ?? "";
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const candidate = realIp || forwarded.split(",").at(-1)?.trim() || "unknown";
  // Bound attacker-controlled input even when this is run away from Vercel.
  const ip = candidate.slice(0, 64);
  return `${prefix}_${hashIp(ip)}`;
}

function hashIp(ip: string): string {
  const configured = process.env.RATE_LIMIT_PEPPER?.trim();
  if (!configured && process.env.NODE_ENV === "production" && !warnedAboutMissingPepper) {
    warnedAboutMissingPepper = true;
    // Loud once, not per request: a flood of this line would itself be the
    // outage. Buckets still work, they just reset when the instance recycles.
    console.error(
      "[rate-limit] RATE_LIMIT_PEPPER is not set. Falling back to a per-process " +
        "pepper: buckets reset on every cold start. Set it (openssl rand -hex 32).",
    );
  }
  const digest = createHmac("sha256", configured || fallbackPepper).update(ip);
  return digest.digest("hex").slice(0, 24);
}

/**
 * Throttle a read path. Returns false only when the caller is over the limit.
 *
 * Fails OPEN by design: these are read/playback paths, so a limiter outage must
 * degrade to "unthrottled", never to "route down". Anything that moves money or
 * writes owner data uses enforceRateLimit (payments/server/auth) instead, which
 * fails closed with a 429.
 */
export async function allowByKey(
  key: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  try {
    const { error } = await runRateLimit(key, limit, windowMs);
    return !error?.message?.includes("RATE_LIMIT");
  } catch {
    return true;
  }
}

/** allowByKey for an unauthenticated caller, keyed by hashed IP. */
export async function allowByIp(
  request: Request,
  prefix: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  // The key is built INSIDE the guard, not as an argument to allowByKey. As an
  // argument it was evaluated before the try/catch below ever ran, so anything
  // thrown while building it escaped the fail-open contract this function
  // promises and 500'd the public route instead of merely skipping the limiter.
  let key: string;
  try {
    key = rateLimitKeyFromIp(request, prefix);
  } catch {
    return true;
  }
  return allowByKey(key, limit, windowMs);
}
