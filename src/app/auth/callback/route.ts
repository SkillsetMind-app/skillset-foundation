import { NextResponse, type NextRequest } from "next/server";

import {
  RESET_PASSWORD_PATH,
  attachRecoveryCookie,
} from "@/lib/auth/recovery-cookie";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// OAuth (Google) landing, plus recovery links minted before the email template
// moved to /auth/confirm. Supabase redirects here with a short-lived `code`
// that we exchange for a session cookie, then forward to `next`.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";
  const safeNext = next.startsWith("/") ? next : "/";

  // A consumed or expired one-time token arrives with Supabase's own error
  // params and no `code`. Forwarding the real reason is what lets the login
  // screen say "already used" instead of guessing "expired" at everything.
  const providerError = searchParams.get("error_code") ?? searchParams.get("error");

  if (!code) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(providerError ?? "missing_code")}`,
    );
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    // Overwhelmingly this is the PKCE verifier missing because the link was
    // opened in a different browser than the one that requested it.
    return NextResponse.redirect(`${origin}/login?error=auth_callback`);
  }

  const response = NextResponse.redirect(`${origin}${safeNext}`);

  // Only a session minted by exchanging a recovery code lands here with
  // next=/reset-password — a plain authenticated session never gets this
  // cookie, which is what proves recovery provenance to the reset page.
  return safeNext === RESET_PASSWORD_PATH
    ? attachRecoveryCookie(response)
    : response;
}
