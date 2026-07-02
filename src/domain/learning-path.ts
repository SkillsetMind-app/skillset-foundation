// Learning Paths v1: platform-curated ordered course sequences shown as
// Netflix-style rows in the members area. Progress rolls up client-side from
// the enrollments the dashboard already streams — a path never stores its own
// progress state.
// ponytail: curation is admin-only (RLS direct writes) — a founder-facing
// authoring UI or teacher-authored paths are the upgrade path if paths stick.

export type LearningPath = {
  id: string;
  title: string;
  description: string;
  // Course ids in curated order.
  courseIds: string[];
};

// The slice of an enrollment the rollup needs (matches @/domain/enrollment).
export type PathEnrollmentSlice = {
  courseId: string;
  progressPercent: number;
  status: string;
};

export type LearningPathProgress = {
  enrolledCount: number;
  completedCount: number;
  // Average progress across ALL courses in the path; not-enrolled counts as 0
  // so the bar reflects distance through the whole path, not just what the
  // student already bought.
  progressPercent: number;
};

export function computePathProgress(
  courseIds: string[],
  enrollments: PathEnrollmentSlice[],
): LearningPathProgress {
  if (courseIds.length === 0) {
    return { enrolledCount: 0, completedCount: 0, progressPercent: 0 };
  }

  const byCourse = new Map(
    enrollments.map((enrollment) => [enrollment.courseId, enrollment]),
  );

  let enrolledCount = 0;
  let completedCount = 0;
  let totalPercent = 0;

  for (const courseId of courseIds) {
    const enrollment = byCourse.get(courseId);
    if (!enrollment) {
      continue;
    }
    enrolledCount += 1;
    const percent = Math.max(0, Math.min(100, enrollment.progressPercent));
    totalPercent += percent;
    if (enrollment.status === "completed" || percent >= 100) {
      completedCount += 1;
    }
  }

  return {
    enrolledCount,
    completedCount,
    progressPercent: Math.round(totalPercent / courseIds.length),
  };
}
