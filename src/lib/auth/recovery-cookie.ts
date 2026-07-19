/**
 * Marks the session as originating from a password-recovery link. Set by
 * /auth/callback when it exchanges a recovery code, read server-side by
 * /reset-password so a regular signed-in session can't reach the
 * no-current-password reset form.
 */
export const PASSWORD_RECOVERY_COOKIE = "password_recovery";
