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
 * If the dedicated pepper is unset, the server-only service-role key supplies
 * equivalent entropy. Only local development/test may use an unkeyed hash;
 * production fails configuration closed when neither secret exists.
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
  // The service-role key is already a server-only high-entropy secret and is a
  // safe fallback. Production must never persist reversible plain IP hashes.
  const pepper =
    process.env.RATE_LIMIT_PEPPER?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!pepper && process.env.NODE_ENV === "production") {
    throw new Error("RATE_LIMIT_PEPPER is required in production.");
  }
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
