import type { NextResponse } from "next/server";

/**
 * Marks the session as originating from a password-recovery link. Set by the
 * auth landing routes when they verify a recovery token, read server-side by
 * /reset-password so a regular signed-in session can't reach the
 * no-current-password reset form.
 */
export const PASSWORD_RECOVERY_COOKIE = "password_recovery";

export const RESET_PASSWORD_PATH = "/reset-password";

/**
 * Stamps recovery provenance onto a redirect. Shared by /auth/confirm
 * (token_hash + verifyOtp — the path recovery emails use) and /auth/callback
 * (PKCE code exchange — OAuth, plus recovery links minted before the template
 * switch). Without this the reset page rejects an otherwise valid session.
 */
export function attachRecoveryCookie(response: NextResponse): NextResponse {
  response.cookies.set(PASSWORD_RECOVERY_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: RESET_PASSWORD_PATH,
    // ponytail: cookie simply expires instead of being cleared post-reset;
    // 10 minutes bounds the window without an extra clearing endpoint.
    maxAge: 600,
  });
  return response;
}
