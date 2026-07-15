import { describe, expect, it } from "vitest";

import {
  getCourseLessonEntries,
  getCourseProgressPercent,
  getLastCompletedCourseLesson,
  getNextCourseLesson,
  getNextCourseLessonAfter,
} from "@/domain/lesson-progress";
import type { Course } from "@/domain/learning";

const course: Course = {
  id: "course-1",
  slug: "effective-communication",
  title: "Effective Communication",
  category: "Soft Skills",
  durationLabel: "4-8 weeks",
  status: "published",
  statusLabel: "Popular",
  summary: "Summary",
  detail: "Detail",
  image: "https://example.com/course.jpg",
  level: "Foundation",
  priceLabel: "$79 early access",
  priceAmountMinor: 7900,
  currency: "USD",
  platformFeeBps: 800,
  freePreviewLabel: "Free preview",
  outcomes: [],
  communityEnabled: true,
  modules: [
    {
      id: "module-1",
      title: "Foundations",
      summary: "Summary",
      lessons: [
        { id: "lesson-1", title: "Welcome", type: "video", duration: "8 min", isPreview: true },
        { id: "lesson-2", title: "Framework", type: "text", duration: "12 min", isPreview: false },
      ],
    },
    {
      id: "module-2",
      title: "Practice",
      summary: "Summary",
      lessons: [
        { id: "lesson-3", title: "Exercise", type: "assignment", duration: "20 min", isPreview: false },
      ],
    },
  ],
};

describe("lesson progress helpers", () => {
  it("flattens course lessons in module order", () => {
    expect(getCourseLessonEntries(course).map((entry) => entry.lesson.id)).toEqual([
      "lesson-1",
      "lesson-2",
      "lesson-3",
    ]);
  });

  it("calculates progress percentage from completed lessons", () => {
    expect(getCourseProgressPercent(course, ["lesson-1"])).toBe(33);
    expect(getCourseProgressPercent(course, ["lesson-1", "lesson-2"])).toBe(67);
    expect(getCourseProgressPercent(course, ["lesson-1", "lesson-2", "lesson-3"])).toBe(100);
  });

  it("finds the next and last completed lessons", () => {
    expect(getNextCourseLesson(course, ["lesson-1"])?.lesson.id).toBe("lesson-2");
    expect(getLastCompletedCourseLesson(course, ["lesson-1", "lesson-3"])?.lesson.id).toBe(
      "lesson-3",
    );
  });

  it("resolves the lesson after the last completed one", () => {
    // Nothing completed yet → first lesson.
    expect(getNextCourseLessonAfter(course, null)?.lesson.id).toBe("lesson-1");
    // After a mid-course lesson → the next in module order.
    expect(getNextCourseLessonAfter(course, "lesson-1")?.lesson.id).toBe("lesson-2");
    expect(getNextCourseLessonAfter(course, "lesson-2")?.lesson.id).toBe("lesson-3");
    // Final lesson completed → no next lesson.
    expect(getNextCourseLessonAfter(course, "lesson-3")).toBeNull();
    // Stale id not in this course → safe fallback to the first lesson.
    expect(getNextCourseLessonAfter(course, "ghost-lesson")?.lesson.id).toBe("lesson-1");
  });
});
