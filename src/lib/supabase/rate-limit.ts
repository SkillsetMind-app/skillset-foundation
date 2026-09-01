import { createHash, createHmac } from "node:crypto";

import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export async function runRateLimit(key: string, limit: number, windowMs: number) {
  return getSupabaseAdminClient().rpc("enforce_rate_limit", {
    p_key: key,
    p_limit: limit,
    p_window_ms: windowMs,
  });
}

/**
 * Rate-limit key for an UNAUTHENTICATED caller. The IP is hashed so the limiter
 * table never stores a raw address; 24 hex chars is plenty to keep buckets apart.
 *
 * Keyed with RATE_LIMIT_PEPPER when it is set. A plain sha256 of an IPv4 is one
 * lookup table away from the address (four billion candidates, seconds of
 * compute), so the stored row would still be personal data in disguise; with the
 * pepper nobody without the server env can turn a row back into a visitor.
 * Unset (local dev, CI) falls back to the unkeyed hash so no route is gated on
 * the variable — production is expected to set it.
 */
export function rateLimitKeyFromIp(request: Request, prefix: string): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  return `${prefix}_${hashIp(ip)}`;
}

function hashIp(ip: string): string {
  const pepper = process.env.RATE_LIMIT_PEPPER;
  const digest = pepper
    ? createHmac("sha256", pepper).update(ip)
    : createHash("sha256").update(ip);
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
  return allowByKey(rateLimitKeyFromIp(request, prefix), limit, windowMs);
}
