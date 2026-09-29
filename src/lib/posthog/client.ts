import type { PostHog } from "posthog-js";

import { getStoredCookieConsent } from "@/lib/consent/cookie-consent";

// posthog-js is ~95 kB gz and captures nothing before an explicit Accept, so
// it is not in the page bundle: it is imported on demand, and only once the
// visitor has accepted. Calls made while it loads are queued in order.
let initialized = false;
let failed = false;
let instance: PostHog | null = null;
const queue: Array<(ph: PostHog) => void> = [];
// Identity set before PostHog started (signed in, not yet accepted), replayed
// on start so events after an Accept stay attached to the signed-in user.
let pendingIdentity: { distinctId: string; properties?: Record<string, unknown> } | null = null;

function withPostHog(fn: (ph: PostHog) => void): void {
  if (instance) fn(instance);
  else if (!failed) queue.push(fn);
}

// Blocked, offline or a stale deploy: analytics is best-effort, so drop what
// was queued and stop queueing for the rest of the page.
function giveUp(): void {
  failed = true;
  queue.length = 0;
}

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

  // GDPR/ePrivacy prior-consent: capture NOTHING until the visitor explicitly
  // accepts. A first-time (null) or rejected visitor never loads PostHog at
  // all; applyAnalyticsConsent(true) starts it once they click Accept.
  if (getStoredCookieConsent() !== "accepted") return;

  initialized = true;
  void import("posthog-js")
    .then(({ default: posthog }) => {
      posthog.init(key, {
        api_host: host,
        person_profiles: "identified_only",
        capture_pageview: false, // we capture manually on route change (App Router)
        capture_pageleave: true,
        autocapture: true,
        // Still re-checked at load time: a Reject in the meantime wins.
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
      if (pendingIdentity) {
        posthog.identify(pendingIdentity.distinctId, pendingIdentity.properties);
        pendingIdentity = null;
      }
      instance = posthog;
      for (const fn of queue.splice(0)) fn(posthog);
    })
    .catch(giveUp);
}

/**
 * Apply a cookie-consent decision to PostHog capture at runtime. Called by the
 * consent banner when the visitor clicks Accept (grant) or Reject (revoke).
 */
export function applyAnalyticsConsent(granted: boolean): void {
  if (typeof window === "undefined") return;
  // The decision is already stored, so an Accept starts PostHog here.
  if (granted) initPostHog();
  if (!initialized) return;

  withPostHog((ph) => {
    if (granted) {
      ph.opt_in_capturing();
    } else {
      ph.opt_out_capturing();
    }
  });
}

/**
 * Hand a product event to PostHog. Returns true only when it was handed over.
 */
export function captureEvent(
  name: string,
  properties?: Record<string, unknown>,
): boolean {
  if (typeof window === "undefined") return false;
  // Same rule as init's opt-out default: nothing is sent without an explicit
  // Accept. Checked here too so a product event never depends on PostHog's own
  // opt-in state having been applied yet.
  if (getStoredCookieConsent() !== "accepted") return false;
  // Page trackers fire from their own effects, and React runs a child's
  // effects before the provider's init effect, so the first event of every
  // full page load hit an uninitialized client and was silently dropped.
  // initPostHog is idempotent (and a no-op without a key).
  initPostHog();
  if (!initialized || failed) return false;
  withPostHog((ph) => ph.capture(name, properties));
  return true;
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
  withPostHog((ph) => ph.captureException(normalized, context));
}

export function identifyUser(
  distinctId: string,
  properties?: Record<string, unknown>,
): void {
  if (typeof window === "undefined") return;
  if (!initialized) {
    pendingIdentity = { distinctId, properties };
    return;
  }
  withPostHog((ph) => ph.identify(distinctId, properties));
}

export function resetUser(): void {
  if (typeof window === "undefined") return;
  pendingIdentity = null;
  if (!initialized) return;
  withPostHog((ph) => ph.reset());
}

