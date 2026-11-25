"use client";

import {
  fetchLessonPosition,
  recordLessonPlayback,
} from "@/lib/data/lesson-playback";

/**
 * Where the lesson stopped, in SECONDS, per person and per lesson.
 *
 * The platform's "resume" was per LESSON — which lesson to open — never per
 * position: someone who stopped at 22 minutes came back at second zero and had to
 * drag the bar until finding the spot.
 *
 * The position lives in the DATABASE (`lesson_playback`, migration 20260903120000) and the
 * browser became the FALLBACK. It was the other way around until PR #186, and the price was
 * known: the position was per browser, so someone who started on a phone and
 * finished on a computer started over from zero there.
 *
 * Both ends are still written on every save, on purpose:
 * - **database first on read**, because it is the one that crosses devices;
 * - **browser always**, because it answers without a network and covers an anonymous session,
 *   the teacher's preview and the moment the database write fails.
 *
 * Opening the lesson is also saved, with a NULL position — the database understands this as
 * "just record the visit", without touching the position. It is the "opened" half of the funnel:
 * `lesson_progress` is only born when the lesson is COMPLETED, so someone who gives up
 * midway left no trace at all.
 */

const PREFIX = "skillset_lesson_pos:";

/** Below this there is nothing to resume — the person barely opened the lesson. */
const MIN_SECONDS = 5;

/** And the end is left out, so the lesson does not reopen in the last seconds. */
const END_MARGIN_SECONDS = 15;

/**
 * "This person, in this lesson". A null `enrollmentId` (teacher preview, anonymous
 * session) keeps everything in the browser: without an enrollment there is no row to write.
 */
export type LessonPositionRef = {
  storageKey: string;
  enrollmentId: string | null;
  lessonId: string;
};

export function lessonPositionRef(
  userId: string | null | undefined,
  enrollmentId: string | null | undefined,
  lessonId: string | null | undefined,
): LessonPositionRef | null {
  if (!userId || !lessonId) {
    return null;
  }

  return {
    storageKey: `${PREFIX}${userId}:${lessonId}`,
    enrollmentId: enrollmentId ?? null,
    lessonId,
  };
}

function readLocal(ref: LessonPositionRef | null): number {
  if (!ref) {
    return 0;
  }

  try {
    const seconds = Number(window.localStorage.getItem(ref.storageKey));

    return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  } catch {
    // Browser with storage blocked: no position, starts from the beginning.
    return 0;
  }
}

function writeLocal(ref: LessonPositionRef | null, seconds: number): void {
  if (!ref) {
    return;
  }

  try {
    if (seconds <= 0) {
      window.localStorage.removeItem(ref.storageKey);
      return;
    }

    window.localStorage.setItem(ref.storageKey, String(seconds));
  } catch {
    // Quota exceeded or storage blocked: resuming is a convenience, it
    // must not take the lesson down.
  }
}

/**
 * Sends to the database without waiting and without breaking: the lesson keeps playing if the
 * network drops, and the browser already saved the same position.
 *
 * ponytail: no queue and no concurrency lock. The players only save every
 * 10 s (SAVE_EVERY_SECONDS), so the worst case of two writes crossing on the
 * network costs the 10 s between them — and the real brake is `enforce_rate_limit` on the
 * server. If the cadence ever tightens, the place to fix it is here.
 */
function pushToDatabase(
  ref: LessonPositionRef,
  seconds: number | null,
  duration?: number,
): void {
  if (!ref.enrollmentId) {
    return;
  }

  void recordLessonPlayback(
    ref.enrollmentId,
    ref.lessonId,
    seconds,
    Number.isFinite(duration) ? duration : null,
  ).catch(() => {
    // With no position in the database the lesson opens at what the browser saved.
  });
}

/** The lesson was opened. Only the visit — the saved position is not touched. */
export function markLessonOpened(ref: LessonPositionRef | null): void {
  if (ref) {
    pushToDatabase(ref, null);
  }
}

/**
 * Database first (crosses devices), browser as the fallback when there is no
 * enrollment or the read fails.
 */
export async function readLessonPosition(
  ref: LessonPositionRef | null,
): Promise<number> {
  if (!ref) {
    return 0;
  }

  if (ref.enrollmentId) {
    try {
      const seconds = await fetchLessonPosition(ref.enrollmentId, ref.lessonId);

      if (seconds > 0) {
        return seconds;
      }
    } catch {
      // Falls back to the browser: without a network the lesson still resumes on this device.
    }
  }

  return readLocal(ref);
}

/**
 * Saves the position — or ERASES it, when it stops being worth keeping (start or end
 * of the lesson). Erasing at the end is what avoids the worst case: finishing the lesson, going back
 * to it and landing straight on the credits.
 */
export function saveLessonPosition(
  ref: LessonPositionRef | null,
  seconds: number,
  duration?: number,
): void {
  if (!ref || !Number.isFinite(seconds)) {
    return;
  }

  const nearEnd =
    Number.isFinite(duration)
    && (duration ?? 0) > 0
    && seconds > (duration as number) - END_MARGIN_SECONDS;
  const guardar = seconds < MIN_SECONDS || nearEnd ? 0 : Math.floor(seconds);

  writeLocal(ref, guardar);
  pushToDatabase(ref, guardar, duration);
}

export function clearLessonPosition(ref: LessonPositionRef | null): void {
  if (!ref) {
    return;
  }

  writeLocal(ref, 0);
  pushToDatabase(ref, 0);
}
