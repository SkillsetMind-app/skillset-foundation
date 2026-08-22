/**
 * hostname -> teacher uid, for the proxy.
 *
 * This runs on EVERY request that reaches the proxy, which makes latency the
 * whole design problem. Three things keep it cheap:
 *
 * 1. `isPlatformHost()` answers first, without touching this module at all. All
 *    of today's traffic arrives on our own hostname and never pays for a lookup.
 *
 * 2. A short in-process cache. Next runs the proxy in a Node isolate that is
 *    reused across requests, so a module-level Map survives between them. It is
 *    not shared between isolates and does not need to be — the worst case is
 *    each isolate doing one query per host per TTL window.
 *
 * 3. Misses are cached too. Without that, a bot spraying random Host headers
 *    would put one database query behind every junk request, which is a free
 *    amplification attack against our own database.
 *
 * The query reads `public_domains`, which holds only verified domains and only
 * hostname + uid. It runs with the anon key, deliberately: the proxy must never
 * carry a service-role credential to the edge.
 */

import { createClient } from "@supabase/supabase-js";

import { getSupabaseClientConfig } from "@/lib/supabase/config";

/**
 * Sixty seconds. The cost of it being wrong in either direction is small and
 * self-correcting: a teacher who has just verified waits at most a minute
 * before their domain answers, and one whose domain was removed keeps serving
 * for at most a minute. Neither is worth the complexity of invalidation.
 */
const TTL_MS = 60_000;

/**
 * Bounded so a Host-header spray cannot grow the map without limit. When it
 * fills, the whole thing is dropped rather than evicted one by one — at this
 * size the difference is imperceptible and the code stays obvious.
 */
const MAX_ENTRIES = 5_000;

type CacheEntry = { uid: string | null; expiresAt: number };

const cache = new Map<string, CacheEntry>();

/** Exported for tests: nothing in the app should need to reach in here. */
export function __clearHostCache(): void {
  cache.clear();
}

function readCache(hostname: string, now: number): CacheEntry | null {
  const entry = cache.get(hostname);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    cache.delete(hostname);
    return null;
  }
  return entry;
}

function writeCache(hostname: string, uid: string | null, now: number): void {
  if (cache.size >= MAX_ENTRIES) {
    cache.clear();
  }
  cache.set(hostname, { uid, expiresAt: now + TTL_MS });
}

export async function resolveHostToUid(
  hostname: string,
  now: number = Date.now(),
): Promise<string | null> {
  const cached = readCache(hostname, now);
  if (cached) {
    return cached.uid;
  }

  const config = getSupabaseClientConfig();
  if (!config) {
    // Supabase not configured — the same pass-through the proxy already does
    // for the session refresh. Not cached: configuration can appear at boot.
    return null;
  }

  const supabase = createClient(config.url, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase
    .from("public_domains")
    .select("uid")
    .eq("hostname", hostname)
    .maybeSingle();

  if (error) {
    // Fail OPEN, and do not cache the failure. A database hiccup must not take
    // custom domains down for a full TTL window, and must never take the
    // platform's own hostname down — which it cannot, since that host never
    // reaches this function.
    return null;
  }

  const uid = data?.uid ?? null;
  writeCache(hostname, uid, now);
  return uid;
}
