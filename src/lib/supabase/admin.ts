import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

import { assertSupabaseClientConfig } from "@/lib/supabase/config";
import type { Database } from "@/lib/supabase/database.types";

// Service-role Supabase client. Bypasses RLS — this is the ONLY client allowed
// to write the server-write-only tables (payments, payout_ledger, orders,
// subscriptions, checkout_locks, processed_stripe_events). Used by webhook +
// trusted server actions after they authorize the caller themselves.
//
// SECURITY: the service_role key is a SECRET. It is read from
// SUPABASE_SERVICE_ROLE_KEY (server-only env, NOT NEXT_PUBLIC) and must never
// reach the browser. The `server-only` package isn't installed in this repo, so
// the runtime `typeof window` guard below is the enforcement: any browser use
// throws before the key is touched (and Next never inlines a non-NEXT_PUBLIC
// env into the client bundle, so the value is undefined there regardless).
let adminClient: SupabaseClient<Database> | null = null;

export function getSupabaseAdminClient(): SupabaseClient<Database> {
  if (typeof window !== "undefined") {
    throw new Error("The Supabase admin client must never run in the browser.");
  }

  if (adminClient) {
    return adminClient;
  }

  const { url } = assertSupabaseClientConfig();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");
  }

  adminClient = createClient<Database>(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return adminClient;
}
