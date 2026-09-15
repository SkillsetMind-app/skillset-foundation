import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// captureEvent is the consent-gated door to PostHog (its own tests cover the
// gate). Here it reports "sent" (true) or "not sent" (false).
const capture = vi.hoisted(() => vi.fn());
vi.mock("@/lib/posthog/client", () => ({ captureEvent: capture }));

import { CourseViewedTracker, PurchaseCompletedTracker } from "@/lib/posthog/page-trackers";

beforeEach(() => {
  capture.mockReset().mockReturnValue(true);
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(cleanup);

// The success URL gets reloaded, bookmarked and reopened in new tabs (a new
// tab starts with an empty sessionStorage). One sale must stay one event.
it("sends purchase_completed once per course, across reloads and new tabs", () => {
  render(<PurchaseCompletedTracker course_id="course-1" />).unmount();
  render(<PurchaseCompletedTracker course_id="course-1" />).unmount();
  window.sessionStorage.clear();
  render(<PurchaseCompletedTracker course_id="course-1" />);
  expect(capture).toHaveBeenCalledExactlyOnceWith("purchase_completed", { course_id: "course-1" });

  cleanup();
  render(<PurchaseCompletedTracker course_id="course-2" />);
  expect(capture).toHaveBeenCalledTimes(2);
  expect(capture).toHaveBeenLastCalledWith("purchase_completed", { course_id: "course-2" });
});

// Seen without consent (nothing sent) is still seen: an Accept on a later day
// must not turn that old purchase into a new one.
it("never counts a purchase later once it was seen without consent", () => {
  capture.mockReturnValue(false);
  render(<PurchaseCompletedTracker course_id="course-1" />).unmount();

  capture.mockReturnValue(true);
  render(<PurchaseCompletedTracker course_id="course-1" />);
  expect(capture).toHaveBeenCalledTimes(1);
});

it("sends course_viewed once with the course id, is_free and currency", () => {
  const view = render(<CourseViewedTracker course_id="course-1" is_free={false} currency="USD" />);
  view.rerender(<CourseViewedTracker course_id="course-1" is_free={false} currency="USD" />);

  expect(capture).toHaveBeenCalledTimes(1);
  expect(capture.mock.calls[0][0]).toBe("course_viewed");
  expect(capture.mock.calls[0][1]).toEqual({ course_id: "course-1", is_free: false, currency: "USD" });
});

// Picking another offer can change currency or free/paid on the same page.
// That is the same view, not a second one.
it("does not re-send course_viewed when an offer switch changes currency or free/paid", () => {
  const view = render(<CourseViewedTracker course_id="course-1" is_free={false} currency="USD" />);
  view.rerender(<CourseViewedTracker course_id="course-1" is_free={false} currency="EUR" />);
  view.rerender(<CourseViewedTracker course_id="course-1" is_free currency="EUR" />);

  expect(capture).toHaveBeenCalledTimes(1);
  expect(capture.mock.calls[0][1]).toEqual({ course_id: "course-1", is_free: false, currency: "USD" });
});
