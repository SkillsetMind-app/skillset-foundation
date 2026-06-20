"use client";

import { useEffect, useState } from "react";

import { StatusChip } from "@/components/shared/status-chip";
import type { TeacherCourse } from "@/domain/teacher-course";
import {
  adminCanRepublishCourse,
  adminCanUnpublishCourse,
} from "@/domain/teacher-course";
import {
  deleteCourseAsAdmin,
  setCourseFeatured,
  subscribeToManagedCourses,
  updateCourseReviewStatus,
} from "@/lib/data/teacher-courses";

export function ManagedCoursePanel() {
  const [courses, setCourses] = useState<TeacherCourse[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [busyCourseId, setBusyCourseId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  useEffect(() => {
    return subscribeToManagedCourses(
      (nextCourses) => {
        setCourses(nextCourses);
        setIsLoading(false);
      },
      () => {
        setError("We could not load published courses. Please refresh.");
        setIsLoading(false);
      },
    );
  }, []);

  async function runAction(
    courseId: string,
    action: () => Promise<void>,
    successMessage: string,
    failureMessage: string,
  ) {
    setError("");
    setSuccess("");
    setBusyCourseId(courseId);

    try {
      await action();
      setSuccess(successMessage);
    } catch {
      setError(failureMessage);
    } finally {
      setBusyCourseId(null);
      setConfirmingDeleteId(null);
    }
  }

  function handleUnpublish(courseId: string) {
    return runAction(
      courseId,
      () =>
        updateCourseReviewStatus(courseId, "inactive", "Unpublished by Skillset admin."),
      "Course unpublished and removed from the marketplace.",
      "We could not unpublish this course. Please try again.",
    );
  }

  function handleRepublish(courseId: string) {
    return runAction(
      courseId,
      () => updateCourseReviewStatus(courseId, "published", null),
      "Course republished to the marketplace.",
      "We could not republish this course. Please try again.",
    );
  }

  function handleDelete(courseId: string) {
    return runAction(
      courseId,
      () => deleteCourseAsAdmin(courseId),
      "Course permanently deleted.",
      "We could not delete this course. Courses with enrollments or orders must be unpublished instead.",
    );
  }

  function handleToggleFeatured(course: TeacherCourse) {
    const nextFeatured = !course.featured;
    return runAction(
      course.id,
      () => setCourseFeatured(course.id, nextFeatured),
      nextFeatured
        ? "Course featured. It now leads the marketplace grid."
        : "Course unfeatured and back in the regular catalog order.",
      "We could not update the featured status. Please try again.",
    );
  }

  return (
    <section className="rounded-[4px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-brand)]">
            Published courses
          </p>
          <h3 className="display-title mt-3 text-3xl text-[var(--color-ink)]">
            Manage the live catalog
          </h3>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
            Unpublish a live course to take it off the marketplace, republish an
            inactive one, or permanently delete a course that has no enrollments
            or orders.
          </p>
        </div>
        <span className="rounded-[8px] bg-[var(--color-surface-soft)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-primary)]">
          {courses.length} courses
        </span>
      </div>

      {error ? (
        <p className="mt-5 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-accent-fg)]">
          {error}
        </p>
      ) : null}

      {success ? (
        <p className="mt-5 info-notice">
          {success}
        </p>
      ) : null}

      <div className="mt-6 grid gap-3">
        {isLoading ? (
          <p className="text-sm text-[var(--color-ink-soft)]">
            Loading published courses...
          </p>
        ) : courses.length === 0 ? (
          <p className="rounded-[4px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-6 text-[var(--color-ink-soft)]">
            No published or inactive courses yet.
          </p>
        ) : (
          courses.map((course) => (
            <article
              key={course.id}
              className="rounded-[4px] border fine-rule bg-[var(--color-surface-soft)] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
                    {course.category}
                  </p>
                  <h4 className="mt-2 text-base font-semibold text-[var(--color-ink)]">
                    {course.title}
                  </h4>
                  <p className="mt-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
                    {course.modules?.length ?? 0} modules - {course.lessonCount ?? 0} lessons
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <StatusChip status={course.status} />
                  {course.featured ? (
                    <span className="rounded-[8px] bg-[var(--color-primary)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-base)]">
                      Featured
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {course.status === "published" ? (
                  <button
                    type="button"
                    onClick={() => handleToggleFeatured(course)}
                    disabled={busyCourseId === course.id}
                    className={
                      course.featured
                        ? "button-outline px-3.5 py-2 text-xs disabled:opacity-60"
                        : "button-solid px-3.5 py-2 text-xs disabled:opacity-60"
                    }
                  >
                    {busyCourseId === course.id
                      ? "Working..."
                      : course.featured
                        ? "Unfeature"
                        : "Feature"}
                  </button>
                ) : null}
                {adminCanUnpublishCourse(course.status) ? (
                  <button
                    type="button"
                    onClick={() => handleUnpublish(course.id)}
                    disabled={busyCourseId === course.id}
                    className="button-outline px-3.5 py-2 text-xs disabled:opacity-60"
                  >
                    {busyCourseId === course.id ? "Working..." : "Unpublish"}
                  </button>
                ) : null}
                {adminCanRepublishCourse(course.status) ? (
                  <button
                    type="button"
                    onClick={() => handleRepublish(course.id)}
                    disabled={busyCourseId === course.id}
                    className="button-solid px-3.5 py-2 text-xs disabled:opacity-60"
                  >
                    {busyCourseId === course.id ? "Working..." : "Republish"}
                  </button>
                ) : null}
                {confirmingDeleteId === course.id ? (
                  <>
                    <button
                      type="button"
                      onClick={() => handleDelete(course.id)}
                      disabled={busyCourseId === course.id}
                      className="inline-flex items-center justify-center rounded-[8px] bg-[var(--color-accent)] px-3.5 py-2 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
                    >
                      {busyCourseId === course.id ? "Deleting..." : "Confirm delete"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingDeleteId(null)}
                      disabled={busyCourseId === course.id}
                      className="button-outline px-3.5 py-2 text-xs disabled:opacity-60"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmingDeleteId(course.id)}
                    disabled={busyCourseId === course.id}
                    className="button-outline px-3.5 py-2 text-xs text-[var(--color-accent-fg)] disabled:opacity-60"
                  >
                    Delete
                  </button>
                )}
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
