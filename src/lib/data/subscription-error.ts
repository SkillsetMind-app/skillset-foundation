"use client";

/**
 * Builds an `onError` handler for a realtime subscription that logs the
 * failure with a stable scope label instead of swallowing it silently.
 *
 * Use this for non-blocking widgets (dashboard KPIs, side panels) that should
 * degrade to an empty/default state on failure but must still surface the
 * error in logs/observability — never an inert `() => {}`.
 */
export function logSubscriptionError(scope: string) {
  return (error: unknown) => {
    console.warn(`[subscription] ${scope} failed`, error);
  };
}
