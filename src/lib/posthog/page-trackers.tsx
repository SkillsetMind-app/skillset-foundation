"use client";

/**
 * Minimal client-only PostHog page trackers.
 *
 * Server components cannot call posthog.capture() directly, so each page
 * route renders one of these zero-output components to record the event
 * exactly once on mount. Source is set per-page so the funnel knows
 * whether a course view came from search, marketplace, direct link, etc.
 */

import { useEffect } from "react";

import { track } from "@/lib/posthog/events";
import type { CourseViewedProps, PurchaseCompletedProps } from "@/lib/posthog/events";

export function CourseViewedTracker(props: CourseViewedProps) {
  // The props are stable for the page, so we only want ONE event per mount
  // even under React Strict Mode double-invoke in dev: a primitive dep set
  // keeps the effect from re-running on unrelated renders.
  const { course_id, slug, source, is_free, currency } = props;

  useEffect(() => {
    track.courseViewed({ course_id, slug, source, is_free, currency });
  }, [course_id, slug, source, is_free, currency]);

  return null;
}

const PURCHASE_SESSION_KEY = "skillset.posthog.purchase_completed.";

/**
 * purchase_completed, at most once per course per browser session. Stripe's
 * success page gets reloaded, reopened from the receipt email and re-rendered
 * while the enrollment poll runs; each of those would otherwise count a second
 * sale. The mark is only set once the event was actually handed to PostHog, so
 * a buyer without analytics consent is never marked (and never counted).
 */
export function PurchaseCompletedTracker({ course_id }: PurchaseCompletedProps) {
  useEffect(() => {
    const key = `${PURCHASE_SESSION_KEY}${course_id}`;
    try {
      if (window.sessionStorage.getItem(key)) return;
    } catch {
      // ponytail: storage blocked -> at worst one extra event per reload.
    }
    if (!track.purchaseCompleted({ course_id })) return;
    try {
      window.sessionStorage.setItem(key, "1");
    } catch {
      // Same as above: nothing to remember it in.
    }
  }, [course_id]);

  return null;
}
