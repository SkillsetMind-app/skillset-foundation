import { cookies } from "next/headers";

import { createServerClient } from "@supabase/ssr";
import {
  AuthError,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";

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
 * O que é confiável em cada metade: os fatores vêm do usuário que o GoTrue
 * acabou de devolver (não do cookie, que o navegador escreve); o `aal` vem do
 * mesmo access token que o GoTrue acabou de validar — assinatura conferida,
 * claim autêntica. Nada aqui lê `session.user`. Token que não decodifica conta
 * como aal1: em dúvida, fecha.
 */
function withSecondFactorGate(
  client: SupabaseClient<Database>,
): SupabaseClient<Database> {
  const getUser = client.auth.getUser.bind(client.auth);

  client.auth.getUser = async (jwt?: string) => {
    const response = await getUser(jwt);

    if (!response.data.user || !hasVerifiedFactor(response.data.user)) {
      return response;
    }

    const accessToken =
      jwt ?? (await client.auth.getSession()).data.session?.access_token;

    if (assuranceLevel(accessToken) === "aal2") {
      return response;
    }

    return {
      data: { user: null },
      error: new AuthError(
        "Finish signing in with the code from your authenticator app.",
        401,
        "mfa_required",
      ),
    };
  };

  return client;
}

function hasVerifiedFactor(user: User): boolean {
  return (user.factors ?? []).some((factor) => factor.status === "verified");
}

/** The `aal` claim of an access token, or null when it cannot be read. */
function assuranceLevel(accessToken: string | undefined): string | null {
  const payload = accessToken?.split(".")[1];

  if (!payload) {
    return null;
  }

  try {
    const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { aal?: unknown };
    return typeof claims.aal === "string" ? claims.aal : null;
  } catch {
    return null;
  }
}
