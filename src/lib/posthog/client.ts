import posthog from "posthog-js";

import { getStoredCookieConsent } from "@/lib/consent/cookie-consent";

let initialized = false;

export function initPostHog(): void {
  if (typeof window === "undefined") return;
  if (initialized) return;

  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

  if (!key) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[posthog] NEXT_PUBLIC_POSTHOG_KEY not set; analytics disabled");
    }
    return;
  }

  posthog.init(key, {
    api_host: host,
    person_profiles: "identified_only",
    capture_pageview: false, // we capture manually on route change (App Router)
    capture_pageleave: true,
    autocapture: true,
    // GDPR/ePrivacy prior-consent: capture NOTHING until the visitor explicitly
    // accepts. A first-time (null) or rejected visitor starts opted-out, so no
    // analytics, autocapture, session recording, or exception capture fires before
    // consent. applyAnalyticsConsent(true) opts in once they click Accept.
    opt_out_capturing_by_default: getStoredCookieConsent() !== "accepted",
    capture_exceptions: true,
    session_recording: {
      maskAllInputs: true,
      maskTextSelector: '[data-sensitive="true"]',
    },
    loaded: (ph) => {
      if (process.env.NODE_ENV === "development") ph.debug(false);
    },
  });

  initialized = true;
}

/**
 * Apply a cookie-consent decision to PostHog capture at runtime. Called by the
 * consent banner when the visitor clicks Accept (grant) or Reject (revoke).
 */
export function applyAnalyticsConsent(granted: boolean): void {
  if (typeof window === "undefined") return;
  if (!initialized) return;

  if (granted) {
    posthog.opt_in_capturing();
  } else {
    posthog.opt_out_capturing();
  }
}

export function captureEvent(
  name: string,
  properties?: Record<string, unknown>,
): void {
  if (typeof window === "undefined") return;
  if (!initialized) return;
  posthog.capture(name, properties);
}

/**
 * Report a caught/boundary exception to PostHog. Used by the App Router error
 * boundaries (error.tsx / global-error.tsx). No-op while opted out (pre-consent).
 */
export function captureException(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  if (typeof window === "undefined") return;
  if (!initialized) return;
  const normalized = error instanceof Error ? error : new Error(String(error));
  posthog.captureException(normalized, context);
}

export function identifyUser(
  distinctId: string,
  properties?: Record<string, unknown>,
): void {
  if (typeof window === "undefined") return;
  if (!initialized) return;
  posthog.identify(distinctId, properties);
}

export function resetUser(): void {
  if (typeof window === "undefined") return;
  if (!initialized) return;
  posthog.reset();
}

export { posthog };
