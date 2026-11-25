import { describe, expect, it } from "vitest";

import { moveLessonTo } from "@/domain/curriculum-move";
import type { TeacherCourseModule, TeacherLesson } from "@/domain/teacher-course";

// A lesson with the fields that left the screen (duration, wait days, text): they
// must travel along, because the full-swap RPC zeroes out whatever does not come.
function lesson(id: string): TeacherLesson {
  return {
    id,
    title: id.toUpperCase(),
    type: "video",
    description: "nota antiga",
    durationMinutes: 7,
    dripDelayDays: 3,
    contentText: "corpo",
    externalUrl: null,
  };
}

function fixture(): TeacherCourseModule[] {
  return [
    { id: "m1", title: "M1", lessons: [lesson("l1"), lesson("l2")] },
    { id: "m2", title: "M2", lessons: [lesson("l3")] },
  ];
}

const ids = (module: TeacherCourseModule) => module.lessons.map((item) => item.id);

describe("moveLessonTo", () => {
  it("moves L2 from M1 to the start of M2 as the same object, with the same id", () => {
    const modules = fixture();
    const l2 = modules[0].lessons[1];
    const course = { freePreviewLessonId: "l2", modules };

    const next = moveLessonTo(course.modules, "l2", "m2", 0);

    expect(ids(next[0])).toEqual(["l1"]);
    expect(ids(next[1])).toEqual(["l2", "l3"]);
    expect(next[1].lessons[0]).toBe(l2);
    expect(next[1].lessons[0]).toEqual(lesson("l2"));
    // The free preview belongs to the course, by id: it does not change with the module change.
    expect(course.freePreviewLessonId).toBe("l2");
    // The input is not mutated (React compares by reference).
    expect(ids(modules[0])).toEqual(["l1", "l2"]);
    expect(ids(modules[1])).toEqual(["l3"]);
  });

  it("an out-of-range index falls to the nearest end", () => {
    expect(ids(moveLessonTo(fixture(), "l1", "m2", 99)[1])).toEqual(["l3", "l1"]);
    expect(ids(moveLessonTo(fixture(), "l1", "m2", -5)[1])).toEqual(["l1", "l3"]);
    expect(ids(moveLessonTo(fixture(), "l1", "m2", Number.NaN)[1])).toEqual(["l1", "l3"]);
  });

  it("reorders within the same module", () => {
    expect(ids(moveLessonTo(fixture(), "l2", "m1", 0)[0])).toEqual(["l2", "l1"]);
  });

  it("same position, or a nonexistent lesson or module: returns the array itself", () => {
    const modules = fixture();
    expect(moveLessonTo(modules, "l2", "m1", 1)).toBe(modules);
    expect(moveLessonTo(modules, "l2", "m1", 50)).toBe(modules);
    expect(moveLessonTo(modules, "ghost", "m2", 0)).toBe(modules);
    expect(moveLessonTo(modules, "l2", "ghost", 0)).toBe(modules);
  });
});
