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

  // Unique channel per subscription: supabase-js returns the EXISTING channel
  // object when .channel() is called with a topic that's already live, and
  // calling .on() on an already-subscribed channel throws ("cannot add
  // postgres_changes callbacks after subscribe()"). Two components watching
  // the same row (AccountMenu + StatusBanner on users:<uid>, dashboard +
  // learning paths on enrollments:user:<uid>, ...) would crash every
  // authenticated page. Suffixing every topic keeps channels independent;
  // unsubscribe still works because callers hold the channel instance.
  const originalChannel = browserClient.channel.bind(browserClient);
  let channelSeq = 0;
  browserClient.channel = (name, opts) => {
    channelSeq += 1;
    return originalChannel(`${name}#${channelSeq}`, opts);
  };

  return browserClient;
}
