export type DripStrategy =
  | "instant"
  | "sequential_progress"
  | "time_drip_lesson"
  | "time_drip_module"
  | "time_drip_custom";

type TimestampLike = {
  toMillis?: () => number;
  seconds?: number;
};

type DripEnrollmentLike = {
  createdAt?: unknown;
};

type DripLessonLike = {
  id: string;
  isPreview?: boolean;
  dripDelayDays?: number | null;
};

type DripCourseLike = {
  dripStrategy?: DripStrategy;
  dripIntervalDays?: number | null;
  modules: Array<{
    lessons: DripLessonLike[];
  }>;
};

export type LessonUnlockState = {
  unlocked: boolean;
  unlocksAt: Date | null;
  reason: "available" | "previous_lesson_required" | "scheduled";
};

const defaultDripIntervalDays = 1;

function timestampToDate(value: unknown): Date | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value;
  }

  // Postgres delivers created_at as an ISO string (or epoch number); without
  // this branch enrolledAt fell through to null and drip gating defaulted to
  // "now", silently unlocking time-dripped lessons on the wrong schedule.
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === "object") {
    const timestamp = value as TimestampLike;

    if (typeof timestamp.toMillis === "function") {
      return new Date(timestamp.toMillis());
    }

    if (typeof timestamp.seconds === "number") {
      return new Date(timestamp.seconds * 1000);
    }
  }

  return null;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function getLessonPosition(course: DripCourseLike, lessonId: string) {
  let globalIndex = 0;

  for (const [moduleIndex, module] of course.modules.entries()) {
    for (const [lessonIndex, lesson] of module.lessons.entries()) {
      if (lesson.id === lessonId) {
        return { moduleIndex, lessonIndex, globalIndex };
      }

      globalIndex += 1;
    }
  }

  return { moduleIndex: 0, lessonIndex: 0, globalIndex: 0 };
}

export function getLessonUnlockState(
  course: DripCourseLike,
  lesson: DripLessonLike,
  enrollment: DripEnrollmentLike | null,
  completedLessonIds: string[],
  now: Date = new Date(),
): LessonUnlockState {
  if (lesson.isPreview) {
    return { unlocked: true, unlocksAt: null, reason: "available" };
  }

  const strategy = course.dripStrategy ?? "instant";

  if (strategy === "instant") {
    return { unlocked: true, unlocksAt: null, reason: "available" };
  }

  const position = getLessonPosition(course, lesson.id);

  if (strategy === "sequential_progress") {
    if (position.globalIndex === 0) {
      return { unlocked: true, unlocksAt: null, reason: "available" };
    }

    const previousLesson = course.modules
      .flatMap((module) => module.lessons)
      .at(position.globalIndex - 1);
    const previousCompleted = previousLesson
      ? completedLessonIds.includes(previousLesson.id)
      : true;

    return previousCompleted
      ? { unlocked: true, unlocksAt: null, reason: "available" }
      : {
          unlocked: false,
          unlocksAt: null,
          reason: "previous_lesson_required",
        };
  }

  const enrolledAt = timestampToDate(enrollment?.createdAt) ?? now;
  const intervalDays = Math.max(
    1,
    Math.round(course.dripIntervalDays ?? defaultDripIntervalDays),
  );
  const delayDays =
    strategy === "time_drip_module"
      ? position.moduleIndex * intervalDays
      : strategy === "time_drip_custom"
        ? Math.max(0, Math.round(lesson.dripDelayDays ?? 0))
        : position.globalIndex * intervalDays;
  const unlocksAt = addDays(enrolledAt, delayDays);

  return now >= unlocksAt
    ? { unlocked: true, unlocksAt, reason: "available" }
    : { unlocked: false, unlocksAt, reason: "scheduled" };
}
