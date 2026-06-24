"use client";

import { reopenCookieConsent } from "@/lib/consent/cookie-consent";

// Footer control that reopens the cookie banner so a visitor can review,
// change, or withdraw their consent at any time (GDPR Art. 7(3) — withdrawal
// must be as easy as granting it; CCPA "Your Privacy Choices"). Rendered inside
// the (server) footer; clicking it clears the stored decision and the banner
// re-appears via the consent store subscription.
export function PrivacyChoicesButton() {
  return (
    <button
      type="button"
      onClick={reopenCookieConsent}
      className="font-semibold text-[var(--color-ink-soft)] underline-offset-2 transition-colors hover:text-[var(--color-primary)] hover:underline"
    >
      Your Privacy Choices
    </button>
  );
}
