"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { assertSupabaseClientConfig } from "@/lib/supabase/config";
import type { Database } from "@/lib/supabase/database.types";

// Browser Supabase client. Lazy singleton, mirroring the getFirebase* factory
// pattern in @/lib/firebase/client. createBrowserClient stores the auth session
// in cookies (not localStorage) so the server (middleware + RSC) can read the
// same session — this is what makes SSR auth work.
let browserClient: SupabaseClient<Database> | null = null;

export function getSupabaseBrowserClient(): SupabaseClient<Database> {
  if (browserClient) {
    return browserClient;
  }

  const { url, anonKey } = assertSupabaseClientConfig();
  browserClient = createBrowserClient<Database>(url, anonKey);

  return browserClient;
}
