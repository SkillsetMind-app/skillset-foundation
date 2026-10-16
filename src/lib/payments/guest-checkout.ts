// Guest checkout: buying a paid course without signing in first. Off unless
// the flag is "true" AND the Turnstile site key the form needs is set. The
// server also needs TURNSTILE_SECRET_KEY and GUEST_CHECKOUT_COOKIE_SECRET (see
// server/guest-checkout.ts); without them its routes answer 404.
export function isGuestCheckoutEnabled(): boolean {
  return process.env.NEXT_PUBLIC_GUEST_CHECKOUT_ENABLED === "true"
    && Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
}

/** "patrick@example.com" -> "p•••@example.com". */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "•••";
  return `${email[0]}•••${email.slice(at)}`;
}
