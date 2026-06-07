import { describe, expect, it } from "vitest";

import {
  aggregateTrendingCounts,
  readEnrollmentCourseId,
  resolveTrendingScore,
  trendingWriteNeeded,
} from "./course-trending";

describe("readEnrollmentCourseId", () => {
  it("returns a trimmed courseId from a valid enrollment doc", () => {
    expect(readEnrollmentCourseId({ courseId: "  course-7  " })).toBe("course-7");
  });

  it("returns null for missing / non-string / empty courseId", () => {
    expect(readEnrollmentCourseId({ courseId: "" })).toBeNull();
    expect(readEnrollmentCourseId({ courseId: "   " })).toBeNull();
    expect(readEnrollmentCourseId({ courseId: 42 })).toBeNull();
    expect(readEnrollmentCourseId({})).toBeNull();
    expect(readEnrollmentCourseId(null)).toBeNull();
    expect(readEnrollmentCourseId(undefined)).toBeNull();
  });
});

describe("aggregateTrendingCounts", () => {
  it("counts enrollments per course within the window", () => {
    const counts = aggregateTrendingCounts(["a", "b", "a", "a", "b", "c"]);
    expect(counts.get("a")).toBe(3);
    expect(counts.get("b")).toBe(2);
    expect(counts.get("c")).toBe(1);
  });

  it("skips invalid courseIds without throwing", () => {
    const counts = aggregateTrendingCounts(["a", "", null, 7, "  a  ", undefined]);
    // "a" and trimmed "  a  " collapse to the same course; junk is ignored.
    expect(counts.get("a")).toBe(2);
    expect(counts.size).toBe(1);
  });

  it("returns an empty map for an empty window", () => {
    expect(aggregateTrendingCounts([]).size).toBe(0);
  });
});

describe("resolveTrendingScore", () => {
  it("returns the count for a course in the window", () => {
    const counts = aggregateTrendingCounts(["a", "a"]);
    expect(resolveTrendingScore(counts, "a")).toBe(2);
  });

  it("returns 0 for a course that fell out of the window (reset target)", () => {
    const counts = aggregateTrendingCounts(["a"]);
    expect(resolveTrendingScore(counts, "b")).toBe(0);
  });
});

describe("trendingWriteNeeded", () => {
  it("writes when the score changes", () => {
    expect(trendingWriteNeeded(2, 5)).toBe(true);
    expect(trendingWriteNeeded(5, 0)).toBe(true);
  });

  it("skips the write when the score is unchanged", () => {
    expect(trendingWriteNeeded(3, 3)).toBe(false);
  });

  it("treats a missing / garbage stored value as 0", () => {
    // Never-scored course that computes to 0 must NOT be written (no churn).
    expect(trendingWriteNeeded(undefined, 0)).toBe(false);
    expect(trendingWriteNeeded(null, 0)).toBe(false);
    expect(trendingWriteNeeded(Number.NaN, 0)).toBe(false);
    // ...but a never-scored course that now has activity IS written.
    expect(trendingWriteNeeded(undefined, 4)).toBe(true);
  });
});
