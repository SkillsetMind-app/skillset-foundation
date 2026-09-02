import type { Course, Lesson } from "@/domain/learning";

export type LessonProgress = {
  lessonId: string;
  userId: string;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type CourseLessonEntry = {
  moduleId: string;
  moduleTitle: string;
  lesson: Lesson;
};

export function getCourseLessonEntries(course: Course): CourseLessonEntry[] {
  return course.modules.flatMap((module) =>
    module.lessons.map((lesson) => ({
      moduleId: module.id,
      moduleTitle: module.title,
      lesson,
    })),
  );
}

export function getCourseProgressPercent(
  course: Course,
  completedLessonIds: readonly string[],
): number {
  const lessons = getCourseLessonEntries(course);

  if (lessons.length === 0) {
    return 0;
  }

  const completedSet = new Set(completedLessonIds);
  const completedCount = lessons.filter((entry) => completedSet.has(entry.lesson.id)).length;

  return Math.round((completedCount / lessons.length) * 100);
}

export function getNextCourseLesson(
  course: Course,
  completedLessonIds: readonly string[],
): CourseLessonEntry | null {
  const completedSet = new Set(completedLessonIds);

  return (
    getCourseLessonEntries(course).find((entry) => !completedSet.has(entry.lesson.id)) ??
    null
  );
}

/**
 * Resolves the lesson that follows the learner's last *completed* lesson
 * (enrollment.lastLessonId). Used by list/dashboard surfaces that know the
 * last completed lesson id but do not load the full completed-lesson set.
 *
 * - null lastLessonId (nothing completed yet) → first lesson
 * - stale id not in this course → first lesson (safe fallback)
 * - last completed lesson is the final one → null (course finished)
 */
export function getNextCourseLessonAfter(
  course: Course,
  lastCompletedLessonId: string | null,
): CourseLessonEntry | null {
  const entries = getCourseLessonEntries(course);

  if (entries.length === 0) {
    return null;
  }

  if (!lastCompletedLessonId) {
    return entries[0];
  }

  const lastIndex = entries.findIndex(
    (entry) => entry.lesson.id === lastCompletedLessonId,
  );

  if (lastIndex < 0) {
    return entries[0];
  }

  return entries[lastIndex + 1] ?? null;
}

export type ResumeCourseLesson = CourseLessonEntry & {
  moduleNumber: number;
  lessonNumber: number;
};

/**
 * A aula que o painel oferece para retomar. O cartao "Continuar" abria a CAPA
 * do curso e a pessoa tinha que achar sozinha onde parou.
 *
 * `lastLessonId` e a ultima aula CONCLUIDA — e so isso que o banco grava
 * (record_lesson_progress escreve enrollments.last_lesson_id ao marcar a aula
 * como feita; abrir uma aula nao grava nada). Retomar, portanto, e a aula
 * SEGUINTE a ela: antes o cartao abria a propria aula ja concluida, e a
 * pessoa reassistia o que acabou de terminar. Concluiu a ultima → o cartao
 * fica nela. Sem registro, ou com um id que nao existe mais no curso, a
 * primeira aula. Os numeros sao 1-based, para o rotulo "Module N · Lesson M".
 */
export function getResumeCourseLesson(
  course: Course,
  lastLessonId: string | null,
): ResumeCourseLesson | null {
  const entries = getCourseLessonEntries(course);
  const entry =
    getNextCourseLessonAfter(course, lastLessonId)
    ?? entries.find((candidate) => candidate.lesson.id === lastLessonId)
    ?? null;

  if (!entry) {
    return null;
  }

  const moduleIndex = course.modules.findIndex(
    (module) => module.id === entry.moduleId,
  );
  const lessonIndex = course.modules[moduleIndex].lessons.findIndex(
    (lesson) => lesson.id === entry.lesson.id,
  );

  return { ...entry, moduleNumber: moduleIndex + 1, lessonNumber: lessonIndex + 1 };
}

/**
 * Minutos que faltam a partir de uma aula, ela inclusa. `lesson.duration` e um
 * rotulo livre ("8 min", "Self-paced"): a soma so vale quando TODAS as aulas
 * restantes trazem um numero de minutos legivel. Com uma ilegivel devolve null
 * e o painel omite o texto, em vez de mostrar uma soma parcial como se fosse
 * o total.
 */
export function getRemainingMinutesFrom(
  course: Course,
  lessonId: string,
): number | null {
  const entries = getCourseLessonEntries(course);
  const start = entries.findIndex((entry) => entry.lesson.id === lessonId);

  if (start < 0) {
    return null;
  }

  let total = 0;
  for (const entry of entries.slice(start)) {
    const match = /^\s*(\d+)\s*min/i.exec(entry.lesson.duration);
    if (!match) {
      return null;
    }
    total += Number(match[1]);
  }

  return total;
}

export function getLastCompletedCourseLesson(
  course: Course,
  completedLessonIds: readonly string[],
): CourseLessonEntry | null {
  const completedSet = new Set(completedLessonIds);
  const completedEntries = getCourseLessonEntries(course).filter((entry) =>
    completedSet.has(entry.lesson.id),
  );

  return completedEntries.at(-1) ?? null;
}
