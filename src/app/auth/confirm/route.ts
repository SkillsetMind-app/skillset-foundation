import { NextResponse, type NextRequest } from "next/server";

import type { EmailOtpType } from "@supabase/supabase-js";

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
  const next = searchParams.get("next") ?? "/welcome";
  const safeNext = next.startsWith("/") ? next : "/welcome";

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

  const reason = providerError ?? "confirm";
  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent(reason)}`,
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
