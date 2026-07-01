// Public Supabase connection config. Mirrors the Firebase config contract:
// return null when any value is missing (so callers can render a friendly
// "being set up" state) and an assert variant that throws for code paths that
// legitimately cannot proceed without a client.
//
// Both values are PUBLIC by design (the URL and the anon/publishable key are
// meant to ship in client bundles; RLS is what protects the data). The SECRET
// service-role key lives only in `SUPABASE_SERVICE_ROLE_KEY` (server-only) and
// is read exclusively by `./admin`.

export type SupabaseClientConfig = {
  url: string;
  anonKey: string;
};

export function getSupabaseClientConfig(): SupabaseClientConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return null;
  }

  return { url, anonKey };
}

export function assertSupabaseClientConfig(): SupabaseClientConfig {
  const config = getSupabaseClientConfig();

  if (!config) {
    throw new Error("Supabase client configuration is missing.");
  }

  return config;
}
