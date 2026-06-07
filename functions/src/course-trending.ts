/**
 * Pure helpers for the marketplace "trending" signal.
 *
 * Kept free of firebase imports so the windowed-count aggregation and the
 * write-skip decision are unit-testable without the Firestore emulator — the
 * same pattern as course-analytics.ts, payment-rules.ts and audit-log.ts. The
 * onEnrollmentCreated trigger and rebuildTrending schedule in index.ts wire
 * these in.
 *
 * Trending is intentionally a RECOUNT, not a running delta: `rebuildTrending`
 * re-derives every course's score from the last-7-days enrollment window on a
 * fixed cadence, so it is naturally idempotent and self-healing — a missed or
 * double-fired enrollment trigger can never corrupt the score, the next run
 * recomputes it from source. The per-enrollment trigger only maintains the
 * lifetime `enrollmentCount` denormalization (a best-effort social-proof
 * counter, the same at-least-once posture as the C1 likes counter).
 */

export const TRENDING_WINDOW_DAYS = 7;

/**
 * Extract a usable courseId from a raw enrollment doc, or null. Shared by the
 * onEnrollmentCreated trigger (which course to bump) and the rebuild
 * aggregation (which course a window enrollment belongs to).
 */
export function readEnrollmentCourseId(data: unknown): string | null {
  if (!data || typeof data !== "object") {
    return null;
  }
  const courseId = (data as { courseId?: unknown }).courseId;
  return typeof courseId === "string" && courseId.trim() ? courseId.trim() : null;
}

/**
 * Group the courseIds of the in-window enrollments into a courseId -> count
 * map. Non-string / empty ids are skipped. The count IS the trending score: a
 * plain "new enrollments in the last 7 days", the simplest honest popularity
 * signal (mirrors how Skool orders by recent activity).
 */
export function aggregateTrendingCounts(
  courseIds: readonly unknown[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const raw of courseIds) {
    const courseId = readEnrollmentCourseId({ courseId: raw });
    if (!courseId) {
      continue;
    }
    counts.set(courseId, (counts.get(courseId) ?? 0) + 1);
  }
  return counts;
}

/**
 * The trending score for a course = its in-window enrollment count, or 0 when
 * it had none. Courses that fell OUT of the window must be reset to 0, which is
 * why the rebuild iterates every live course rather than only the ones with
 * recent activity.
 */
export function resolveTrendingScore(
  counts: Map<string, number>,
  courseId: string,
): number {
  return counts.get(courseId) ?? 0;
}

/**
 * Whether the rebuild needs to write the course doc: only when the freshly
 * computed score differs from what is stored. A missing / non-finite stored
 * value is treated as 0, so a never-scored course that computes to 0 is left
 * untouched — no pointless write and no snapshot churn for the marketplace
 * listeners that subscribe to the course docs.
 */
export function trendingWriteNeeded(
  storedScore: unknown,
  nextScore: number,
): boolean {
  const previous =
    typeof storedScore === "number" && Number.isFinite(storedScore)
      ? storedScore
      : 0;
  return previous !== nextScore;
}
