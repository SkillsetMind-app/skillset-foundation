"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

import {
  setStoredCookieConsent,
  shouldShowCookieBanner,
  subscribeCookieConsent,
  type CookieConsentDecision,
} from "@/lib/consent/cookie-consent";
import { applyAnalyticsConsent } from "@/lib/posthog/client";

export function CookieConsent() {
  // Derive visibility from the consent store. The server snapshot is always
  // "false" so the banner is never part of the server markup; after hydration
  // the client re-reads localStorage and shows it only when still undecided.
  // This is SSR-safe and avoids calling setState inside an effect.
  const visible = useSyncExternalStore(
    subscribeCookieConsent,
    shouldShowCookieBanner,
    () => false,
  );

  function decide(decision: CookieConsentDecision) {
    setStoredCookieConsent(decision);
    applyAnalyticsConsent(decision === "accepted");
  }

  if (!visible) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Cookie preferences"
      className="cookie-consent"
    >
      <div className="cookie-consent__inner">
        <p className="cookie-consent__text">
          Skillset uses cookies to keep you signed in and to understand how the
          platform is used so we can improve it. You can reject non-essential
          cookies anytime. See our{" "}
          <Link href="/legal/privacy" className="cookie-consent__link">
            Privacy Policy
          </Link>
          .
        </p>
        <div className="cookie-consent__actions">
          <Link
            href="/legal/privacy"
            className="button-outline px-4 py-2 text-sm"
          >
            Manage preferences
          </Link>
          <button
            type="button"
            onClick={() => decide("rejected")}
            className="button-outline px-4 py-2 text-sm"
          >
            Reject non-essential
          </button>
          <button
            type="button"
            onClick={() => decide("accepted")}
            className="button-solid px-4 py-2 text-sm"
          >
            Accept all
          </button>
        </div>
      </div>
    </div>
  );
}
