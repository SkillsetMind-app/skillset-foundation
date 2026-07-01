import { cookies } from "next/headers";

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { assertSupabaseClientConfig } from "@/lib/supabase/config";
import type { Database } from "@/lib/supabase/database.types";

// Server-side Supabase client bound to the request's cookies, for Route
// Handlers and Server Components. Reads the session cookie written by the
// browser client so auth.uid() drives RLS in trusted server code.
//
// cookies() is async in Next 15+/16, so this is async and must be awaited
// per-request (never cached across requests — the cookie store is per-request).
export async function createSupabaseServerClient(): Promise<
  SupabaseClient<Database>
> {
  const { url, anonKey } = assertSupabaseClientConfig();
  const cookieStore = await cookies();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        // In a Server Component the cookie store is read-only and this throws;
        // that's expected — middleware refreshes the session, so swallowing it
        // here is the documented @supabase/ssr pattern.
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // no-op: called from a Server Component render.
        }
      },
    },
  });
}
