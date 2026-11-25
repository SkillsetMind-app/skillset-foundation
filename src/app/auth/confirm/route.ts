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

  // Expired or already used signup confirmation link (or reminder). Before, it
  // landed on the login with "password change" text and no way to ask for another.
  // Password change and email change do not come in here: they have their own type. The course
  // access link (type=email too) goes to /loading, and the reminder
  // always to /welcome: only /welcome counts as a signup, otherwise a learner with a
  // confirmed account would land on a "resend confirmation" that never arrives. An invitation
  // (/invitations/...) is also left out, even coming from a signup.
  const entry = new URL(safeNext, origin);
  const confirmsSignup = (type === "signup" && ["/welcome", "/loading"].includes(entry.pathname))
    || (type === "email" && entry.pathname === "/welcome");
  if (confirmsSignup) {
    // Clicked twice or already confirmed in this browser: the session is here,
    // so go straight in — to the course, when the link carried one. /loading decides
    // between onboarding and the destination, like the link that worked.
    const { data } = await supabase.auth.getUser();
    if (data.user?.email_confirmed_at) {
      return NextResponse.redirect(`${origin}${getLoadingRoute(
        "welcome",
        getAuthPathIntentFromSearchParams(entry.searchParams),
        getSafeReturnTo(entry.searchParams),
      )}`);
    }
  }

  // confirm_expired opens the "this link expired" screen on the login with resend.
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
