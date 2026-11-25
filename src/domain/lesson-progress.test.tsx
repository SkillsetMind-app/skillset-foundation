import { describe, expect, it } from "vitest";

import {
  getCourseLessonEntries,
  getCourseProgressPercent,
  getLastCompletedCourseLesson,
  getNextCourseLesson,
  getNextCourseLessonAfter,
  getRemainingMinutesFrom,
  getResumeCourseLesson,
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

  it("never rounds an unfinished course up to 100%", () => {
    const lessons = Array.from({ length: 200 }, (_, index) => ({
      id: `big-${index + 1}`,
      title: `Lesson ${index + 1}`,
      type: "text" as const,
      duration: "1 min",
      isPreview: false,
    }));
    const bigCourse: Course = {
      ...course,
      modules: [{ id: "big", title: "Big", summary: "Summary", lessons }],
    };
    const ids = lessons.map((lesson) => lesson.id);

    expect(getCourseProgressPercent(bigCourse, ids.slice(0, 199))).toBe(99);
    expect(getCourseProgressPercent(bigCourse, ids)).toBe(100);
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

// The panel's "Continue" opened the course cover: the person had to find
// on their own where they had stopped. These helpers give the panel the right lesson and the label
// "Module N · Lesson M · X min left" without inventing a number.
describe("lesson to resume on the panel", () => {
  // last_lesson_id is the last COMPLETED lesson (it is what the database stores). Resuming
  // means the next one, not the one the person just finished.
  it("resumes at the lesson after the last completed one, with a 1-based position", () => {
    const resume = getResumeCourseLesson(course, "lesson-2");
    expect(resume?.lesson.id).toBe("lesson-3");
    expect(resume?.moduleNumber).toBe(2);
    expect(resume?.lessonNumber).toBe(1);
  });

  it("completed the last lesson: the card stays on it, without inventing a next one", () => {
    const resume = getResumeCourseLesson(course, "lesson-3");
    expect(resume?.lesson.id).toBe("lesson-3");
  });

  it("with no record, or with an id that no longer exists, falls back to the first lesson", () => {
    expect(getResumeCourseLesson(course, null)?.lesson.id).toBe("lesson-1");
    expect(getResumeCourseLesson(course, "ghost-lesson")?.lesson.id).toBe("lesson-1");
    expect(getResumeCourseLesson(course, null)?.moduleNumber).toBe(1);
    expect(getResumeCourseLesson(course, null)?.lessonNumber).toBe(1);
  });

  it("a course with no lessons has nothing to resume", () => {
    expect(getResumeCourseLesson({ ...course, modules: [] }, null)).toBeNull();
  });

  it("adds up the minutes from the resumed lesson to the end", () => {
    expect(getRemainingMinutesFrom(course, "lesson-1")).toBe(40);
    expect(getRemainingMinutesFrom(course, "lesson-2")).toBe(32);
    expect(getRemainingMinutesFrom(course, "lesson-3")).toBe(20);
  });

  it("omits the minutes when any remaining lesson has no number", () => {
    // Real courses store "Self-paced" when the teacher does not give a duration
    // (published-courses.ts). A partial sum would lie about the total.
    const selfPaced = {
      ...course,
      modules: [
        {
          ...course.modules[0],
          lessons: [
            { ...course.modules[0].lessons[0], duration: "Self-paced" },
            course.modules[0].lessons[1],
          ],
        },
        course.modules[1],
      ],
    };
    expect(getRemainingMinutesFrom(selfPaced, "lesson-1")).toBeNull();
    // The unreadable lesson is already behind: from there on the total is readable.
    expect(getRemainingMinutesFrom(selfPaced, "lesson-2")).toBe(32);
    expect(getRemainingMinutesFrom(course, "ghost-lesson")).toBeNull();
  });
});
