import type { DripStrategy } from "@/domain/drip-policy";

/**
 * Tabela única de casos da liberação da aula (drip), usada dos dois lados:
 *
 *   - src/domain/drip-policy-parity.test.ts roda cada caso na regra do JS
 *     (getLessonUnlockState, do mesmo jeito que a rota do vídeo chama);
 *   - supabase/tests/20260915020000_liberacao_da_aula_no_banco_smoke.sql roda o
 *     mesmo caso em public.lesson_is_released, no banco.
 *
 * O teste do vitest confere que o bloco `drip-parity-cases` do smoke é
 * exatamente esta lista (toSqlTuple). Mudou um lado sem o outro, fica vermelho.
 */

// O mesmo currículo nos seis cursos do smoke (lá os ids ganham o prefixo do
// curso, porque lesson_id é único em course_lesson_content).
// Posição global: a=0, b=1, p=2, c=3. Módulo: a, b, p no 0; c no 1.
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

// courses.free_preview_lesson_id de todos os cursos do smoke.
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
  // null = aluno sem matrícula (sem data de entrada).
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

// A linha exata que o caso ocupa no bloco `drip-parity-cases` do smoke SQL.
export function toSqlTuple(item: DripParityCase): string {
  return `('${item.name}', '${item.course}', '${item.lessonId}', ${item.enrolledDaysAgo ?? "null"}, '{${item.completedLessonIds.join(",")}}', ${item.released})`;
}
