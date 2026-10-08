import { NextResponse, type NextRequest } from "next/server";

import type { EmailOtpType } from "@supabase/supabase-js";
import {
  getAuthErrorRoute,
  getAuthPathIntentFromSearchParams,
  getLoadingRoute,
  getSafeReturnTo,
} from "@/lib/auth/routing";

import {
  RESET_PASSWORD_PATH,
  attachRecoveryCookie,
} from "@/lib/auth/recovery-cookie";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Email confirmation landing (signup verification, email-change, and password
// recovery). Supabase links arrive either with a `token_hash` + `type`
// (verifyOtp) or a `code` (PKCE exchange); handle both, then forward to `next`.
//
// verifyOtp is stateless, which is why recovery emails point here rather than
// at /auth/callback: PKCE stores its code_verifier in a cookie belonging to the
// browser+origin that requested the reset, so opening the link anywhere else
// (phone, in-app webview, other browser, www vs apex) could never complete.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  let next = searchParams.get("next") ?? "/welcome";
  const emailRedirect = searchParams.get("redirect_to");
  if (emailRedirect) {
    next = "/welcome";
    try {
      const redirect = new URL(emailRedirect);
      if (redirect.origin === origin) {
        if (redirect.pathname === "/auth/confirm") next = redirect.searchParams.get("next") ?? "/welcome";
        if (redirect.pathname === "/loading") next = redirect.pathname + redirect.search;
      }
    } catch { /* Old or malformed email: use the normal welcome entry. */ }
  }
  // /welcome and /loading are intentional auth destinations here; their nested
  // returnTo uses the shared deep-link guard. All other paths use it directly.
  let safeNext = getSafeReturnTo(new URLSearchParams({ returnTo: next })) ?? "/welcome";
  if (next.startsWith("/") && !next.startsWith("//") && !next.includes("\\")) {
    const destination = new URL(next, origin);
    if (destination.origin === origin && ["/welcome", "/loading"].includes(destination.pathname)) {
      if (destination.searchParams.has("returnTo") && !getSafeReturnTo(destination.searchParams)) destination.searchParams.delete("returnTo");
      safeNext = destination.pathname + destination.search;
    }
  }

  // Supabase reports a consumed/expired one-time token by redirecting here
  // with error params and no token at all. Forward its reason instead of
  // flattening every failure into the same opaque message.
  const providerError = searchParams.get("error_code") ?? searchParams.get("error");

  const supabase = await createSupabaseServerClient();

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) {
      return finish(origin, safeNext, type === "recovery");
    }
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return finish(origin, safeNext, safeNext === RESET_PASSWORD_PATH);
    }
  }

  // Link de confirmacao do cadastro (ou o lembrete) vencido ou ja usado. Antes
  // caia no login com texto de "troca de senha" e sem como pedir outro.
  // Troca de senha e troca de e-mail nao entram aqui: tem tipo proprio. O link
  // de acesso a curso (type=email tambem) vai para /loading, e o lembrete
  // sempre para /welcome: so o /welcome conta como cadastro, senao o aluno com
  // conta confirmada caia num "reenviar confirmacao" que nunca chega. Convite
  // (/invitations/...) tambem fica de fora, mesmo vindo de um cadastro.
  const entry = new URL(safeNext, origin);
  const confirmsSignup = (type === "signup" && ["/welcome", "/loading"].includes(entry.pathname))
    || (type === "email" && entry.pathname === "/welcome");
  if (confirmsSignup) {
    // Clicou duas vezes ou ja confirmou neste navegador: a sessao esta aqui,
    // entao entra direto — no curso, quando o link trazia um. /loading decide
    // entre o onboarding e o destino, como o link que deu certo.
    const { data } = await supabase.auth.getUser();
    if (data.user?.email_confirmed_at) {
      return NextResponse.redirect(`${origin}${getLoadingRoute(
        "welcome",
        getAuthPathIntentFromSearchParams(entry.searchParams),
        getSafeReturnTo(entry.searchParams),
      )}`);
    }
  }

  // confirm_expired abre no login a tela "este link venceu" com reenviar.
  const reason = confirmsSignup ? "confirm_expired" : providerError ?? "confirm";
  return NextResponse.redirect(
    `${origin}${getAuthErrorRoute(reason, next)}`,
  );
}

function finish(origin: string, safeNext: string, isRecovery: boolean) {
  const response = NextResponse.redirect(`${origin}${safeNext}`);
  // Only a session minted from a recovery token may reach the reset form —
  // a plain authenticated session never gets this cookie.
  return isRecovery && safeNext === RESET_PASSWORD_PATH
    ? attachRecoveryCookie(response)
    : response;
}
