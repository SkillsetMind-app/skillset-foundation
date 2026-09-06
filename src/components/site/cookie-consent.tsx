"use client";

import { useTranslation } from "@/components/i18n/i18n-provider";

import Link from "next/link";
import { useSyncExternalStore } from "react";

import {
  setStoredCookieConsent,
  shouldShowCookieBanner,
  subscribeCookieConsent,
  type CookieConsentDecision,
} from "@/lib/consent/cookie-consent";
import { applyAnalyticsConsent } from "@/lib/posthog/client";
import { brand } from "@/data/brand";

export function CookieConsent() {
  const { t } = useTranslation();
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
      aria-label={t("publicPages.cookies.cookie_preferences")}
      className="cookie-consent"
    >
      <div className="cookie-consent__inner">
        <p className="cookie-consent__text">
          {brand.name} {t("publicPages.cookies.uses_cookies_to_keep_you_signed")}{" "}
          <Link href="/legal/privacy" className="cookie-consent__link">
            {t("publicPages.cookies.privacy_policy")}
          </Link>
          .
        </p>
        <div className="cookie-consent__actions">
          <Link
            href="/legal/privacy"
            className="button-outline px-4 py-2 text-sm"
          >
            {t("publicPages.cookies.manage_preferences")}
          </Link>
          <button
            type="button"
            onClick={() => decide("rejected")}
            className="button-outline px-4 py-2 text-sm"
          >
            {t("publicPages.cookies.reject_non_essential")}
          </button>
          <button
            type="button"
            onClick={() => decide("accepted")}
            className="button-solid px-4 py-2 text-sm"
          >
            {t("publicPages.cookies.accept_all")}
          </button>
        </div>
      </div>
    </div>
  );
}
