import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export async function runRateLimit(key: string, limit: number, windowMs: number) {
  return getSupabaseAdminClient().rpc("enforce_rate_limit", {
    p_key: key,
    p_limit: limit,
    p_window_ms: windowMs,
  });
}
