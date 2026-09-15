import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// captureEvent is the consent-gated door to PostHog (its own tests cover the
// gate). Here it reports "sent" (true) or "not sent" (false).
const capture = vi.hoisted(() => vi.fn());
vi.mock("@/lib/posthog/client", () => ({ captureEvent: capture }));

import { CourseViewedTracker, PurchaseCompletedTracker } from "@/lib/posthog/page-trackers";

beforeEach(() => {
  capture.mockReset().mockReturnValue(true);
  window.sessionStorage.clear();
});
afterEach(cleanup);

// Stripe's success page is reloaded, reopened from the receipt and re-rendered
// by the enrollment poll. One sale must stay one event.
it("sends purchase_completed once per course per session, reloads included", () => {
  render(<PurchaseCompletedTracker course_id="course-1" />).unmount();
  render(<PurchaseCompletedTracker course_id="course-1" />);
  expect(capture).toHaveBeenCalledExactlyOnceWith("purchase_completed", { course_id: "course-1" });

  cleanup();
  render(<PurchaseCompletedTracker course_id="course-2" />);
  expect(capture).toHaveBeenCalledTimes(2);
  expect(capture).toHaveBeenLastCalledWith("purchase_completed", { course_id: "course-2" });
});

// Nothing sent (no consent) means nothing to deduplicate: the session must not
// be marked, or a buyer who accepts afterwards would never be counted.
it("does not mark the session when the event was not sent", () => {
  capture.mockReturnValue(false);
  render(<PurchaseCompletedTracker course_id="course-1" />).unmount();

  capture.mockReturnValue(true);
  render(<PurchaseCompletedTracker course_id="course-1" />);
  expect(capture).toHaveBeenCalledTimes(2);
});

it("sends course_viewed once with the course id, is_free and currency", () => {
  const view = render(<CourseViewedTracker course_id="course-1" is_free={false} currency="USD" />);
  view.rerender(<CourseViewedTracker course_id="course-1" is_free={false} currency="USD" />);

  expect(capture).toHaveBeenCalledTimes(1);
  expect(capture.mock.calls[0][0]).toBe("course_viewed");
  expect(capture.mock.calls[0][1]).toEqual({ course_id: "course-1", is_free: false, currency: "USD" });
});
