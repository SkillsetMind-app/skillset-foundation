import { describe, expect, it } from "vitest";

import {
  normalizeCourseReviewBody,
  normalizeCourseReviewRating,
} from "@/domain/course-review";

// Both feed upsert_course_review (20260716000200_live_application_rpcs.sql),
// which re-validates everything server-side. These normalizers exist so the
// common case never round-trips to a raised exception — they are not the
// security boundary, and the tests below say so where it matters.
describe("normalizeCourseReviewRating", () => {
  it("clamps into the 1..5 star range", () => {
    expect(normalizeCourseReviewRating(3)).toBe(3);
    expect(normalizeCourseReviewRating(0)).toBe(1);
    expect(normalizeCourseReviewRating(-4)).toBe(1);
    expect(normalizeCourseReviewRating(9)).toBe(5);
  });

  it("rounds fractional ratings to the nearest star", () => {
    expect(normalizeCourseReviewRating(3.4)).toBe(3);
    expect(normalizeCourseReviewRating(3.6)).toBe(4);
  });

  it("returns 0 for non-finite input, which the RPC then rejects", () => {
    // 0 is deliberately OUTSIDE the clamp range. It is a sentinel: the RPC
    // raises "Rating must be between 1 and 5" on it, so a NaN slipping through
    // the form surfaces as an error instead of silently writing a 1-star
    // review the learner never chose.
    expect(normalizeCourseReviewRating(Number.NaN)).toBe(0);
    expect(normalizeCourseReviewRating(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("normalizeCourseReviewBody", () => {
  it("trims and treats blank text as no review body", () => {
    expect(normalizeCourseReviewBody("  Great course  ")).toBe("Great course");
    expect(normalizeCourseReviewBody("")).toBeNull();
    expect(normalizeCourseReviewBody("   \n\t ")).toBeNull();
  });

  it("caps the body at 1200 characters, matching the RPC", () => {
    const long = "a".repeat(1300);
    expect(normalizeCourseReviewBody(long)).toHaveLength(1200);
  });
});
