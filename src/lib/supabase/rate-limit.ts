import { createHash } from "node:crypto";

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
 */
export function rateLimitKeyFromIp(request: Request, prefix: string): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  return `${prefix}_${createHash("sha256").update(ip).digest("hex").slice(0, 24)}`;
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
