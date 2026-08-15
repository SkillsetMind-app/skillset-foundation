import { describe, expect, it } from "vitest";

import { getLessonUnlockState } from "@/domain/drip-policy";
import type { Course } from "@/domain/learning";

// lesson-1 is a preview and sits at global index 0 / module 0.
// lesson-2 is global index 1 / module 0. lesson-3 is global index 2 / module 1.
const baseCourse: Course = {
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

const lessonById = (id: string) =>
  baseCourse.modules.flatMap((module) => module.lessons).find((lesson) => lesson.id === id)!;

// Postgres hands back created_at as an ISO string, not a Date.
const enrollment = { createdAt: "2026-01-01T00:00:00.000Z" };
const oneDayIn = new Date("2026-01-02T00:00:00.000Z");

describe("getLessonUnlockState", () => {
  it("never gates a preview lesson, whatever the strategy", () => {
    for (const dripStrategy of ["sequential_progress", "time_drip_lesson"] as const) {
      const state = getLessonUnlockState(
        { ...baseCourse, dripStrategy, dripIntervalDays: 30 },
        lessonById("lesson-1"),
        enrollment,
        [],
        oneDayIn,
      );
      expect(state).toEqual({ unlocked: true, unlocksAt: null, reason: "available" });
    }
  });

  it("unlocks everything when the course has no drip (the default)", () => {
    const state = getLessonUnlockState(baseCourse, lessonById("lesson-3"), null, [], oneDayIn);
    expect(state.unlocked).toBe(true);
  });

  describe("sequential_progress", () => {
    const course: Course = { ...baseCourse, dripStrategy: "sequential_progress" };

    it("locks a lesson until the one before it is complete", () => {
      const locked = getLessonUnlockState(course, lessonById("lesson-2"), enrollment, [], oneDayIn);
      expect(locked).toEqual({
        unlocked: false,
        unlocksAt: null,
        reason: "previous_lesson_required",
      });

      // This is the auto-advance chain: finishing lesson-2 has to open lesson-3
      // in the same pass, which is why enrolled-course-workspace recomputes the
      // unlock state with the just-completed id appended instead of reusing the
      // map it built on render.
      const unlocked = getLessonUnlockState(
        course,
        lessonById("lesson-3"),
        enrollment,
        ["lesson-1", "lesson-2"],
        oneDayIn,
      );
      expect(unlocked.unlocked).toBe(true);
    });

    it("does not cascade — completing lesson-1 opens only lesson-2", () => {
      const completed = ["lesson-1"];
      expect(
        getLessonUnlockState(course, lessonById("lesson-2"), enrollment, completed, oneDayIn).unlocked,
      ).toBe(true);
      expect(
        getLessonUnlockState(course, lessonById("lesson-3"), enrollment, completed, oneDayIn).unlocked,
      ).toBe(false);
    });
  });

  describe("time drip", () => {
    it("spaces lessons by interval x position", () => {
      const course: Course = {
        ...baseCourse,
        dripStrategy: "time_drip_lesson",
        dripIntervalDays: 2,
      };

      // lesson-2 is index 1 => day 2, still ahead of the day-1 clock.
      const pending = getLessonUnlockState(course, lessonById("lesson-2"), enrollment, [], oneDayIn);
      expect(pending.unlocked).toBe(false);
      expect(pending.reason).toBe("scheduled");
      expect(pending.unlocksAt?.toISOString()).toBe("2026-01-03T00:00:00.000Z");

      const later = getLessonUnlockState(
        course,
        lessonById("lesson-2"),
        enrollment,
        [],
        new Date("2026-01-04T00:00:00.000Z"),
      );
      expect(later.unlocked).toBe(true);
      expect(later.reason).toBe("available");
    });

    it("spaces by module for time_drip_module, so a whole module lands at once", () => {
      const course: Course = {
        ...baseCourse,
        dripStrategy: "time_drip_module",
        dripIntervalDays: 3,
      };

      // module 0 => zero delay, open on enrollment day.
      expect(
        getLessonUnlockState(course, lessonById("lesson-2"), enrollment, [], oneDayIn).unlocked,
      ).toBe(true);

      const nextModule = getLessonUnlockState(
        course,
        lessonById("lesson-3"),
        enrollment,
        [],
        oneDayIn,
      );
      expect(nextModule.unlocked).toBe(false);
      expect(nextModule.unlocksAt?.toISOString()).toBe("2026-01-04T00:00:00.000Z");
    });

    it("uses the lesson's own delay for time_drip_custom", () => {
      const course: Course = {
        ...baseCourse,
        dripStrategy: "time_drip_custom",
        dripIntervalDays: 90,
      };
      const lesson = { ...lessonById("lesson-2"), dripDelayDays: 5 };

      const state = getLessonUnlockState(course, lesson, enrollment, [], oneDayIn);
      expect(state.unlocked).toBe(false);
      expect(state.unlocksAt?.toISOString()).toBe("2026-01-06T00:00:00.000Z");
    });

    it("falls back to now when there is no enrollment date, rather than unlocking early", () => {
      const course: Course = {
        ...baseCourse,
        dripStrategy: "time_drip_lesson",
        dripIntervalDays: 1,
      };

      // No enrollment row: the clock starts now, so a dripped lesson stays shut
      // instead of reading as "enrolled at epoch, therefore long overdue".
      const state = getLessonUnlockState(course, lessonById("lesson-2"), null, [], oneDayIn);
      expect(state.unlocked).toBe(false);
      expect(state.unlocksAt?.toISOString()).toBe("2026-01-03T00:00:00.000Z");
    });
  });
});
