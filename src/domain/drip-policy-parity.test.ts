import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getLessonUnlockState } from "@/domain/drip-policy";
import {
  type DripParityCase,
  dripParityCases,
  dripParityCourses,
  dripParityModules,
  dripParityPreviewLessonId,
  toSqlTuple,
} from "@/domain/drip-policy-parity-cases";

// Lesson release applies in two places: in JS (video route and the
// classroom) and in the database (public.lesson_is_released, in the text, link and
// material policies). Both must answer the same. This test runs the table in JS and
// checks that the SQL smoke runs the SAME table; the smoke runs it in the database.
const smokePath = join(
  process.cwd(),
  "supabase",
  "tests",
  "20260915020000_liberacao_da_aula_no_banco_smoke.sql",
);
const now = new Date("2026-03-01T12:00:00.000Z");
const dayMs = 24 * 60 * 60 * 1000;

// The same path as isLessonDripLocked (src/app/api/courses/video-token):
// instant opens before anything else, a lesson outside the curriculum opens, and the sample lesson
// is the course's free_preview_lesson_id.
function releasedLikeTheRoute(item: DripParityCase): boolean {
  const course = { ...dripParityCourses[item.course], modules: dripParityModules };
  if ((course.dripStrategy ?? "instant") === "instant") {
    return true;
  }
  const lesson = dripParityModules
    .flatMap((module) => module.lessons)
    .find((candidate) => candidate.id === item.lessonId);
  if (!lesson) {
    return true;
  }
  return getLessonUnlockState(
    course,
    { ...lesson, isPreview: lesson.id === dripParityPreviewLessonId },
    item.enrolledDaysAgo === null
      ? null
      : { createdAt: new Date(now.getTime() - item.enrolledDaysAgo * dayMs) },
    item.completedLessonIds,
    now,
  ).unlocked;
}

describe("lesson release: JS and database with the same table", () => {
  it.each(dripParityCases)("$name", (item) => {
    expect(releasedLikeTheRoute(item)).toBe(item.released);
  });

  it("the SQL smoke runs exactly these cases", () => {
    const smoke = readFileSync(smokePath, "utf8");
    const block = smoke.split("-- drip-parity-cases:begin")[1]?.split("-- drip-parity-cases:end")[0] ?? "";
    const sqlTuples = block
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("("))
      .map((line) => line.replace(/[,;]$/, ""));

    expect(sqlTuples.sort()).toEqual(dripParityCases.map(toSqlTuple).sort());
  });

  it("the SQL smoke builds the same curriculum and the same strategies", () => {
    const smoke = readFileSync(smokePath, "utf8");
    for (const lesson of dripParityModules.flatMap((module) => module.lessons)) {
      expect(smoke).toContain(`'id', p || '-${lesson.id}', 'dripDelayDays', ${lesson.dripDelayDays})`);
    }
    expect(smoke).toContain(`k.key || '-${dripParityPreviewLessonId}'`);
    for (const [key, course] of Object.entries(dripParityCourses)) {
      const strategy = course.dripStrategy ? `'${course.dripStrategy}'` : "null";
      expect(smoke).toContain(`('${key}', ${strategy}, ${course.dripIntervalDays ?? "null"})`);
    }
  });
});
