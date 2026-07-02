"use client";

import Image from "next/image";
import Link from "next/link";
import { CheckCircle2, PlayCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

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
  const [paths, setPaths] = useState<LearningPath[]>([]);
  const [courses, setCourses] = useState<TeacherCourse[]>([]);

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
                  Learning path
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
                  {progress.completedCount}/{path.courseIds.length} completed ·{" "}
                  {progress.progressPercent}%
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
                const href = enrollment
                  ? `/learn/courses/${enrollment.courseSlug || courseId}`
                  : `/courses/${courseId}`;

                return (
                  <li
                    key={courseId}
                    className="w-[240px] shrink-0 rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-3"
                  >
                    <div className="relative aspect-[16/10] overflow-hidden rounded-[10px]">
                      <Image
                        src={course.coverImageUrl || "/brand/logo-mark.png"}
                        alt={course.title}
                        fill
                        sizes="240px"
                        className="object-cover"
                      />
                      <span className="absolute left-2 top-2 grid size-7 place-items-center rounded-full bg-[var(--color-primary)] text-xs font-bold text-white">
                        {index + 1}
                      </span>
                    </div>
                    <h4 className="mt-3 line-clamp-2 text-sm font-semibold leading-5 text-[var(--color-primary)]">
                      {course.title}
                    </h4>
                    <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
                      {isCompleted
                        ? "Completed"
                        : enrollment
                          ? `${Math.max(0, Math.min(100, enrollment.progressPercent))}% complete`
                          : "Not enrolled yet"}
                    </p>
                    <Link
                      href={href}
                      className={`${enrollment ? "button-solid" : "button-outline"} mt-3 inline-flex w-full items-center justify-center gap-2 px-3 py-2 text-xs`}
                    >
                      {isCompleted ? (
                        <CheckCircle2 size={14} aria-hidden="true" />
                      ) : (
                        <PlayCircle size={14} aria-hidden="true" />
                      )}
                      {isCompleted
                        ? "Review course"
                        : enrollment
                          ? "Continue"
                          : "View course"}
                    </Link>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </>
  );
}
