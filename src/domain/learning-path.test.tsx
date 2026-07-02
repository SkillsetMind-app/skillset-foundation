import { describe, expect, it } from "vitest";

import { computePathProgress } from "@/domain/learning-path";

describe("computePathProgress", () => {
  it("averages across ALL path courses, counting not-enrolled as 0", () => {
    const progress = computePathProgress(
      ["a", "b", "c", "d"],
      [
        { courseId: "a", progressPercent: 100, status: "completed" },
        { courseId: "b", progressPercent: 50, status: "active" },
        // c and d not enrolled
      ],
    );
    expect(progress.enrolledCount).toBe(2);
    expect(progress.completedCount).toBe(1);
    expect(progress.progressPercent).toBe(38); // (100+50+0+0)/4 = 37.5 → 38
  });

  it("ignores enrollments for courses outside the path and clamps percents", () => {
    const progress = computePathProgress(
      ["a"],
      [
        { courseId: "a", progressPercent: 140, status: "active" },
        { courseId: "zz", progressPercent: 90, status: "active" },
      ],
    );
    expect(progress.enrolledCount).toBe(1);
    // 140 clamps to 100 → counts as completed even without the status flag.
    expect(progress.completedCount).toBe(1);
    expect(progress.progressPercent).toBe(100);
  });

  it("returns zeros for an empty path", () => {
    expect(computePathProgress([], [])).toEqual({
      enrolledCount: 0,
      completedCount: 0,
      progressPercent: 0,
    });
  });
});
