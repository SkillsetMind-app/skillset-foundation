import { cookies } from "next/headers";

import { createServerClient } from "@supabase/ssr";
import { AuthError, type SupabaseClient } from "@supabase/supabase-js";

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

  const client = createServerClient<Database>(url, anonKey, {
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

  return withSecondFactorGate(client);
}

/**
 * An aal1 session for an account with a verified second factor is not a login (A-17).
 *
 * `signInWithPassword` writes the aal1 cookie BEFORE the TOTP code, and each
 * route decides "is the user logged in?" with `auth.getUser()`. Eleven routes go
 * through requireUserId and six read getUser() directly — the only point ALL of
 * them go through is this client. So this is where the answer changes: for a
 * session that still owes the second factor, `getUser()` answers as if there
 * were no session, with `error.code = "mfa_required"`. Every route already
 * handles "no user".
 *
 * The database decides: `session_is_strong()` reads the `aal` from the same JWT
 * that PostgREST validated and the factors straight from `auth.mfa_factors`. The
 * GoTrue response does not carry `user.factors` for the aal1 session, so it
 * cannot be used for this decision. The common path stays at a single query
 * (session_is_strong already includes account_session_allowed); the second one,
 * only when the session is weak, tells "owes the code" apart from "account
 * blocked". An error in either one: close.
 */
function withSecondFactorGate(
  client: SupabaseClient<Database>,
): SupabaseClient<Database> {
  const getUser = client.auth.getUser.bind(client.auth);

  client.auth.getUser = async (jwt?: string) => {
    const response = await getUser(jwt);

    if (!response.data.user) {
      return response;
    }

    // Live database verdict, including previously issued sessions. All route
    // callers (also those using service-role writes afterwards) pass here.
    // Check the same explicit JWT as getUser, not a different cookie session.
    try {
      const strongCheck = client.rpc("session_is_strong");
      if (jwt) strongCheck.setHeader("Authorization", `Bearer ${jwt}`);
      const { data: strong, error: strongError } = await strongCheck;
      if (!strongError && strong === true) return response;

      if (!strongError && strong === false) {
        const allowedCheck = client.rpc("account_session_allowed");
        if (jwt) allowedCheck.setHeader("Authorization", `Bearer ${jwt}`);
        const { data: allowed, error: allowedError } = await allowedCheck;
        if (!allowedError && allowed === true) {
          return {
            data: { user: null },
            error: new AuthError(
              "Finish signing in with the code from your authenticator app.",
              401,
              "mfa_required",
            ),
          };
        }
      }
    } catch {
      // An unavailable status check is not permission to use the account.
    }
    return {
      data: { user: null },
      error: new AuthError("Account access is unavailable.", 403, "account_access_denied"),
    };
  };

  return client;
}
