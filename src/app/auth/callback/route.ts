import { NextResponse, type NextRequest } from "next/server";

import { PASSWORD_RECOVERY_COOKIE } from "@/lib/auth/recovery-cookie";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// OAuth (Google) + recovery-link landing. Supabase redirects here with a
// short-lived `code` that we exchange for a session cookie, then forward to
// `next` (defaults to the app root).
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";
  const safeNext = next.startsWith("/") ? next : "/";

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=auth_callback`);
  }

  const response = NextResponse.redirect(`${origin}${safeNext}`);

  // Only a session minted by exchanging a recovery code lands here with
  // next=/reset-password — a plain authenticated session never gets this
  // cookie, which is what proves recovery provenance to the reset page.
  if (safeNext === "/reset-password") {
    response.cookies.set(PASSWORD_RECOVERY_COOKIE, "1", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/reset-password",
      // ponytail: cookie simply expires instead of being cleared post-reset;
      // 10 minutes bounds the window without an extra clearing endpoint.
      maxAge: 600,
    });
  }

  return response;
}
