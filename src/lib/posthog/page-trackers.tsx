"use client";

/**
 * Minimal client-only PostHog page trackers.
 *
 * Server components cannot call posthog.capture() directly, so each page
 * route renders one of these zero-output components to record the event
 * exactly once on mount. Source is set per-page so the funnel knows
 * whether a course view came from search, marketplace, direct link, etc.
 */

import { useEffect, useRef } from "react";

import { track } from "@/lib/posthog/events";
import type { CourseViewedProps, PurchaseCompletedProps } from "@/lib/posthog/events";

export function CourseViewedTracker(props: CourseViewedProps) {
  // One event per course per mount. Switching offers can change currency or
  // free/paid, and that is the same view, not a new one: the values sent are
  // the ones current when this course first rendered here.
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });
  const { course_id } = props;

  useEffect(() => {
    const { slug, source, is_free, currency } = latest.current;
    track.courseViewed({ course_id, slug, source, is_free, currency });
  }, [course_id]);

  return null;
}

const PURCHASE_KEY = "skillset.posthog.purchase_completed.";

/**
 * purchase_completed, at most once per course per browser. The mark lives in
 * localStorage (every tab, every later visit): the success URL gets reloaded,
 * bookmarked and reopened in new tabs, and each of those used to count another
 * sale. It is set the first time the paid course opens after a checkout
 * return, whether or not the event was sent, so a consent Accept on a later
 * day can never count an old purchase as a new one.
 */
export function PurchaseCompletedTracker({ course_id }: PurchaseCompletedProps) {
  useEffect(() => {
    const key = `${PURCHASE_KEY}${course_id}`;
    try {
      if (window.localStorage.getItem(key)) return;
      window.localStorage.setItem(key, "1");
    } catch {
      // ponytail: storage blocked -> dropping ?checkout from the URL is the
      // only guard left against a repeat.
    }
    track.purchaseCompleted({ course_id });
  }, [course_id]);

  return null;
}
