"use client";

import Link from "next/link";
import { CheckCircle2, Lock, PlayCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import {
  CourseCover,
  CourseUnlockModal,
} from "@/components/learn/course-unlock-modal";
import type { Enrollment } from "@/domain/enrollment";
import type { LearningPath } from "@/domain/learning-path";
import { computePathProgress } from "@/domain/learning-path";
import type { TeacherCourse } from "@/domain/teacher-course";
import { fetchPublishedLearningPaths } from "@/lib/data/learning-paths";
import { subscribeToPublishedTeacherCourses } from "@/lib/data/published-courses";

// Netflix-style curated rows in the members area: each published path renders
// as a horizontally scrollable sequence of course cards with a rolled-up
// progress bar. Renders nothing while there are no published paths, so the
// dashboard is unchanged until curation happens.
export function LearningPathsRows({ enrollments }: { enrollments: Enrollment[] }) {
  const { t } = useTranslation();
  const [paths, setPaths] = useState<LearningPath[]>([]);
  const [courses, setCourses] = useState<TeacherCourse[]>([]);
  // The course whose padlock was clicked — drives the unlock popup. Kept here
  // (not per card) so only one dialog can ever be open.
  const [lockedCourse, setLockedCourse] = useState<TeacherCourse | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchPublishedLearningPaths()
      .then((nextPaths) => {
        if (!cancelled) {
          setPaths(nextPaths);
        }
      })
      // Paths are additive discovery UI — on error just render nothing.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (paths.length === 0) {
      return;
    }
    return subscribeToPublishedTeacherCourses(setCourses, () => undefined);
  }, [paths.length]);

  const coursesById = useMemo(
    () => new Map(courses.map((course) => [course.id, course])),
    [courses],
  );
  const enrollmentsByCourse = useMemo(
    () => new Map(enrollments.map((enrollment) => [enrollment.courseId, enrollment])),
    [enrollments],
  );

  const renderablePaths = paths
    .map((path) => ({
      ...path,
      // Only courses that are still publicly listed render as steps.
      courseIds: path.courseIds.filter((courseId) => coursesById.has(courseId)),
    }))
    .filter((path) => path.courseIds.length > 0);

  if (renderablePaths.length === 0) {
    return null;
  }

  return (
    <>
      {renderablePaths.map((path) => {
        const progress = computePathProgress(path.courseIds, enrollments);

        return (
          <section
            key={path.id}
            className="dash-card dash-card--strong p-4 shadow-[var(--shadow-soft)] sm:p-6"
          >
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
                  {t("learn.paths.eyebrow")}
                </p>
                <h3 className="display-title mt-2 text-3xl text-[var(--color-primary)]">
                  {path.title}
                </h3>
                {path.description ? (
                  <p className="mt-2 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
                    {path.description}
                  </p>
                ) : null}
              </div>
              <div className="w-full max-w-[260px]">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--color-primary)]">
                  {t("learn.paths.progress")
                    .replace("{completed}", String(progress.completedCount))
                    .replace("{total}", String(path.courseIds.length))
                    .replace("{percent}", String(progress.progressPercent))}
                </p>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-[rgba(26,54,93,0.12)]">
                  <div
                    className="h-full rounded-full bg-[var(--color-accent)]"
                    style={{ width: `${progress.progressPercent}%` }}
                  />
                </div>
              </div>
            </div>

            <ol className="mt-5 flex gap-4 overflow-x-auto pb-2">
              {path.courseIds.map((courseId, index) => {
                const course = coursesById.get(courseId);
                if (!course) {
                  return null;
                }
                const enrollment = enrollmentsByCourse.get(courseId);
                const isCompleted =
                  enrollment?.status === "completed"
                  || (enrollment?.progressPercent ?? 0) >= 100;
                // No enrollment row means the student never paid for this step,
                // so the card is padlocked and clicking it opens the unlock
                // popup instead of navigating away from the dashboard.
                const isLocked = !enrollment;

                return (
                  <li
                    key={courseId}
                    className="w-[240px] shrink-0 rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-3"
                  >
                    <div className="relative aspect-[16/10] overflow-hidden rounded-[10px]">
                      <CourseCover course={course} sizes="240px" />
                      <span className="absolute left-2 top-2 grid size-7 place-items-center rounded-full bg-[var(--color-primary)] text-xs font-bold text-white">
                        {index + 1}
                      </span>
                      {isLocked ? (
                        <>
                          <span className="absolute inset-0 bg-[rgba(15,39,68,0.45)]" />
                          <span className="absolute right-2 top-2 grid size-7 place-items-center rounded-full bg-[rgba(15,39,68,0.78)] text-white">
                            <Lock aria-hidden="true" size={13} />
                          </span>
                        </>
                      ) : null}
                    </div>
                    <h4 className="mt-3 line-clamp-2 text-sm font-semibold leading-5 text-[var(--color-primary)]">
                      {course.title}
                    </h4>
                    <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
                      {isCompleted
                        ? t("learn.paths.completed")
                        : enrollment
                          ? t("learn.paths.percentComplete").replace(
                              "{percent}",
                              String(
                                Math.max(0, Math.min(100, enrollment.progressPercent)),
                              ),
                            )
                          : t("learn.paths.locked")}
                    </p>
                    {isLocked ? (
                      <button
                        type="button"
                        onClick={() => setLockedCourse(course)}
                        className="button-outline mt-3 inline-flex w-full items-center justify-center gap-2 px-3 py-2 text-xs"
                      >
                        <Lock size={14} aria-hidden="true" />
                        {t("learn.paths.unlock")}
                      </button>
                    ) : (
                      <Link
                        href={`/learn/courses/${enrollment.courseSlug || courseId}`}
                        className="button-solid mt-3 inline-flex w-full items-center justify-center gap-2 px-3 py-2 text-xs"
                      >
                        {isCompleted ? (
                          <CheckCircle2 size={14} aria-hidden="true" />
                        ) : (
                          <PlayCircle size={14} aria-hidden="true" />
                        )}
                        {isCompleted
                          ? t("learn.paths.reviewCourse")
                          : t("learn.paths.continue")}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
      <CourseUnlockModal
        course={lockedCourse}
        onClose={() => setLockedCourse(null)}
      />
    </>
  );
}
