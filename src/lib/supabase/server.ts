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
 * Sessão aal1 de conta com segundo fator verificado não é login (A-17).
 *
 * `signInWithPassword` grava o cookie aal1 ANTES do código TOTP, e cada rota
 * decide "está logado?" com `auth.getUser()`. Onze rotas passam por
 * requireUserId e seis leem getUser() direto — o único ponto por onde TODAS
 * passam é este cliente. Então é aqui que a resposta muda: para uma sessão que
 * ainda deve o segundo fator, `getUser()` responde como se não houvesse
 * sessão, com `error.code = "mfa_required"`. Toda rota já trata "sem usuário".
 *
 * Quem decide é o banco: `session_is_strong()` lê o `aal` do mesmo JWT que o
 * PostgREST validou e os fatores direto de `auth.mfa_factors`. A resposta do
 * GoTrue não traz `user.factors` para a sessão aal1, então ela não serve para
 * esta decisão. O caminho comum continua com uma consulta só (session_is_strong já inclui
 * account_session_allowed); a segunda, só quando a sessão é fraca, separa
 * "deve o código" de "conta bloqueada". Erro em qualquer uma: fecha.
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
