import type { DripStrategy } from "@/domain/drip-policy";

/**
 * Single table of lesson release (drip) cases, used on both sides:
 *
 *   - src/domain/drip-policy-parity.test.ts runs each case on the JS rule
 *     (getLessonUnlockState, the same way the video route calls it);
 *   - supabase/tests/20260915020000_liberacao_da_aula_no_banco_smoke.sql runs the
 *     same case in public.lesson_is_released, in the database.
 *
 * The vitest test checks that the `drip-parity-cases` block of the smoke is
 * exactly this list (toSqlTuple). If one side changes without the other, it goes red.
 */

// The same curriculum in the six courses of the smoke (there the ids get the course
// prefix, because lesson_id is unique in course_lesson_content).
// Global position: a=0, b=1, p=2, c=3. Module: a, b, p in 0; c in 1.
export const dripParityModules = [
  {
    lessons: [
      { id: "a", dripDelayDays: 0 },
      { id: "b", dripDelayDays: 7 },
      { id: "p", dripDelayDays: 30 },
    ],
  },
  { lessons: [{ id: "c", dripDelayDays: 1 }] },
];

// courses.free_preview_lesson_id of all the courses in the smoke.
export const dripParityPreviewLessonId = "p";

export const dripParityCourses = {
  instant: { dripStrategy: "instant", dripIntervalDays: null },
  none: { dripStrategy: undefined, dripIntervalDays: null },
  custom: { dripStrategy: "time_drip_custom", dripIntervalDays: null },
  sequential: { dripStrategy: "sequential_progress", dripIntervalDays: null },
  module: { dripStrategy: "time_drip_module", dripIntervalDays: 3 },
  lesson: { dripStrategy: "time_drip_lesson", dripIntervalDays: 2 },
} satisfies Record<string, { dripStrategy: DripStrategy | undefined; dripIntervalDays: number | null }>;

export type DripParityCourse = keyof typeof dripParityCourses;

export type DripParityCase = {
  name: string;
  course: DripParityCourse;
  lessonId: string;
  // null = learner without enrollment (no entry date).
  enrolledDaysAgo: number | null;
  completedLessonIds: string[];
  released: boolean;
};

export const dripParityCases: DripParityCase[] = [
  { name: "instant opens a later lesson", course: "instant", lessonId: "c", enrolledDaysAgo: 0, completedLessonIds: [], released: true },
  { name: "no strategy behaves as instant", course: "none", lessonId: "c", enrolledDaysAgo: 0, completedLessonIds: [], released: true },
  { name: "the free preview lesson ignores its own delay", course: "custom", lessonId: "p", enrolledDaysAgo: 0, completedLessonIds: [], released: true },
  { name: "custom: 0-day lesson opens on enrollment day", course: "custom", lessonId: "a", enrolledDaysAgo: 0, completedLessonIds: [], released: true },
  { name: "custom: 7-day lesson stays closed on enrollment day", course: "custom", lessonId: "b", enrolledDaysAgo: 0, completedLessonIds: [], released: false },
  { name: "custom: 7-day lesson stays closed on day 6", course: "custom", lessonId: "b", enrolledDaysAgo: 6, completedLessonIds: [], released: false },
  { name: "custom: 7-day lesson opens on day 7", course: "custom", lessonId: "b", enrolledDaysAgo: 7, completedLessonIds: [], released: true },
  { name: "sequential: the first lesson is always open", course: "sequential", lessonId: "a", enrolledDaysAgo: 0, completedLessonIds: [], released: true },
  { name: "sequential: lesson 2 waits for lesson 1", course: "sequential", lessonId: "b", enrolledDaysAgo: 0, completedLessonIds: [], released: false },
  { name: "sequential: lesson 2 opens after lesson 1", course: "sequential", lessonId: "b", enrolledDaysAgo: 0, completedLessonIds: ["a"], released: true },
  { name: "sequential: no cascade past an unfinished lesson", course: "sequential", lessonId: "c", enrolledDaysAgo: 0, completedLessonIds: ["a", "b"], released: false },
  { name: "sequential: the preview counts as a previous lesson", course: "sequential", lessonId: "c", enrolledDaysAgo: 0, completedLessonIds: ["p"], released: true },
  { name: "module: first module opens on enrollment day", course: "module", lessonId: "b", enrolledDaysAgo: 0, completedLessonIds: [], released: true },
  { name: "module: second module waits one interval", course: "module", lessonId: "c", enrolledDaysAgo: 2, completedLessonIds: [], released: false },
  { name: "module: second module opens after one interval", course: "module", lessonId: "c", enrolledDaysAgo: 3, completedLessonIds: [], released: true },
  { name: "lesson: second lesson waits one interval", course: "lesson", lessonId: "b", enrolledDaysAgo: 1, completedLessonIds: [], released: false },
  { name: "lesson: second lesson opens after one interval", course: "lesson", lessonId: "b", enrolledDaysAgo: 2, completedLessonIds: [], released: true },
  { name: "lesson: fourth lesson closed one day before", course: "lesson", lessonId: "c", enrolledDaysAgo: 5, completedLessonIds: [], released: false },
  { name: "lesson: fourth lesson opens after three intervals", course: "lesson", lessonId: "c", enrolledDaysAgo: 6, completedLessonIds: [], released: true },
  { name: "a lesson missing from the curriculum is not scheduled", course: "lesson", lessonId: "ghost", enrolledDaysAgo: 0, completedLessonIds: [], released: true },
  { name: "no enrollment date starts the clock now", course: "lesson", lessonId: "b", enrolledDaysAgo: null, completedLessonIds: [], released: false },
];

// The exact line the case occupies in the `drip-parity-cases` block of the SQL smoke.
export function toSqlTuple(item: DripParityCase): string {
  return `('${item.name}', '${item.course}', '${item.lessonId}', ${item.enrolledDaysAgo ?? "null"}, '{${item.completedLessonIds.join(",")}}', ${item.released})`;
}
