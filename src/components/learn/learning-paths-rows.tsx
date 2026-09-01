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
import { getPublicProfilesByIds } from "@/lib/data/user-profiles";

// Netflix-style rows in the members area, in two flavours:
//
//   1. Curated learning paths — an ordered sequence of course cards with a
//      rolled-up progress bar. Only render when an operator has published one.
//   2. "More from <instructor>" — the Hotmart standard. For every instructor
//      the student already bought from, their remaining published courses, so
//      the dashboard is never an empty shelf. Cross-instructor promotion is
//      deliberately out of scope: a student only ever sees the catalog of the
//      instructors they already know.
//
// Renders nothing only when both are empty (a student with no enrollments and
// no curated paths).
export function LearningPathsRows({ enrollments }: { enrollments: Enrollment[] }) {
  const { t } = useTranslation();
  const [paths, setPaths] = useState<LearningPath[]>([]);
  const [courses, setCourses] = useState<TeacherCourse[]>([]);
  const [ownerNames, setOwnerNames] = useState<Map<string, string>>(new Map());
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

  // Always live, not gated on paths: the instructor rows need the published
  // catalog even when nobody has curated a path.
  useEffect(
    () => subscribeToPublishedTeacherCourses(setCourses, () => undefined),
    [],
  );

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

  // One row per instructor the student already bought from, carrying that
  // instructor's other published courses. Anything already on screen as a
  // curated step is dropped so the same cover never appears twice.
  const instructorRows = useMemo(() => {
    const shownInPaths = new Set(renderablePaths.flatMap((path) => path.courseIds));
    const ownerIds = new Set(
      enrollments
        .map((enrollment) => coursesById.get(enrollment.courseId)?.ownerId)
        .filter((ownerId): ownerId is string => Boolean(ownerId)),
    );

    return Array.from(ownerIds)
      .map((ownerId) => ({
        ownerId,
        courses: courses.filter(
          (course) =>
            course.ownerId === ownerId
            && !enrollmentsByCourse.has(course.id)
            && !shownInPaths.has(course.id),
        ),
      }))
      .filter((row) => row.courses.length > 0);
    // renderablePaths is derived from these same inputs, so recomputing on the
    // raw sources keeps the dependency list honest.
  }, [courses, coursesById, enrollments, enrollmentsByCourse, renderablePaths]);

  const instructorRowKey = instructorRows.map((row) => row.ownerId).join(",");
  useEffect(() => {
    const ids = instructorRowKey ? instructorRowKey.split(",") : [];
    if (ids.length === 0) {
      return;
    }
    let cancelled = false;
    getPublicProfilesByIds(ids)
      .then((profiles) => {
        if (!cancelled) {
          setOwnerNames(
            new Map(
              profiles
                .filter((profile) => Boolean(profile.displayName))
                .map((profile) => [profile.uid, profile.displayName as string]),
            ),
          );
        }
      })
      // The name is decoration — without it the row falls back to a generic
      // heading rather than disappearing.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [instructorRowKey]);

  if (renderablePaths.length === 0 && instructorRows.length === 0) {
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
                <h2 className="display-title mt-2 text-3xl text-[var(--color-primary)]">
                  {path.title}
                </h2>
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

                return (
                  <CourseRowCard
                    key={courseId}
                    course={course}
                    enrollment={enrollmentsByCourse.get(courseId)}
                    stepNumber={index + 1}
                    onLockedClick={setLockedCourse}
                  />
                );
              })}
            </ol>
          </section>
        );
      })}

      {instructorRows.map((row) => (
        <section
          key={row.ownerId}
          className="dash-card dash-card--strong p-4 shadow-[var(--shadow-soft)] sm:p-6"
        >
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            {t("learn.paths.instructorEyebrow")}
          </p>
          <h2 className="display-title mt-2 text-3xl text-[var(--color-primary)]">
            {ownerNames.get(row.ownerId)
              ? t("learn.paths.instructorTitle").replace(
                  "{name}",
                  ownerNames.get(row.ownerId) as string,
                )
              : t("learn.paths.instructorTitleFallback")}
          </h2>

          <ol className="mt-5 flex gap-4 overflow-x-auto pb-2">
            {row.courses.map((course) => (
              <CourseRowCard
                key={course.id}
                course={course}
                enrollment={undefined}
                onLockedClick={setLockedCourse}
              />
            ))}
          </ol>
        </section>
      ))}

      <CourseUnlockModal
        course={lockedCourse}
        onClose={() => setLockedCourse(null)}
      />
    </>
  );
}

// One card, shared by both row flavours. `stepNumber` is what separates them:
// a curated path numbers its steps, an instructor row does not.
function CourseRowCard({
  course,
  enrollment,
  stepNumber,
  onLockedClick,
}: {
  course: TeacherCourse;
  enrollment: Enrollment | undefined;
  stepNumber?: number;
  onLockedClick: (course: TeacherCourse) => void;
}) {
  const { t } = useTranslation();
  const isCompleted =
    enrollment?.status === "completed"
    || (enrollment?.progressPercent ?? 0) >= 100;
  // No enrollment row means the student never paid for this course, so the card
  // is padlocked and clicking it opens the unlock popup instead of navigating
  // away from the dashboard.
  const isLocked = !enrollment;

  return (
    <li className="w-[240px] shrink-0 rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-3">
      <div className="relative aspect-[16/10] overflow-hidden rounded-[10px]">
        <CourseCover course={course} sizes="240px" />
        {stepNumber ? (
          <span className="absolute left-2 top-2 grid size-7 place-items-center rounded-full bg-[var(--color-primary)] text-xs font-bold text-white">
            {stepNumber}
          </span>
        ) : null}
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
                String(Math.max(0, Math.min(100, enrollment.progressPercent))),
              )
            : t("learn.paths.locked")}
      </p>
      {!enrollment ? (
        <button
          type="button"
          onClick={() => onLockedClick(course)}
          className="button-outline mt-3 inline-flex w-full items-center justify-center gap-2 px-3 py-2 text-xs"
        >
          <Lock size={14} aria-hidden="true" />
          {t("learn.paths.unlock")}
        </button>
      ) : (
        <Link
          href={`/learn/courses/${enrollment.courseSlug || course.id}`}
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
}
