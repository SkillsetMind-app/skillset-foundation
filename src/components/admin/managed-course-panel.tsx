"use client";

import { useEffect, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { StatusChip } from "@/components/shared/status-chip";
import { InlineAlert } from "@/components/ui";
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
import { getCourseCategoryLabel } from "@/lib/i18n/course-categories";

export function ManagedCoursePanel() {
  const { t } = useTranslation();
  const copy = "platform.ops.catalogPanel";
  const [courses, setCourses] = useState<TeacherCourse[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [busyCourseId, setBusyCourseId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  useEffect(() => {
    return subscribeToManagedCourses(
      (nextCourses) => {
        setCourses(nextCourses);
        setLoadError(false);
        setIsLoading(false);
      },
      () => {
        setLoadError(true);
        setIsLoading(false);
      },
    );
  }, []);

  async function runAction(
    courseId: string,
    action: () => Promise<void>,
    successKey: string,
    failureKey: string,
  ) {
    setError("");
    setSuccess("");
    setBusyCourseId(courseId);

    try {
      await action();
      setSuccess(successKey);
    } catch {
      setError(failureKey);
    } finally {
      setBusyCourseId(null);
      setConfirmingDeleteId(null);
    }
  }

  function handleUnpublish(courseId: string) {
    return runAction(
      courseId,
      () =>
        updateCourseReviewStatus(courseId, "inactive", "Unpublished by SkillsetMind admin."),
      "unpublished",
      "unpublish",
    );
  }

  function handleRepublish(courseId: string) {
    return runAction(
      courseId,
      () => updateCourseReviewStatus(courseId, "published", null),
      "republished",
      "republish",
    );
  }

  function handleDelete(courseId: string) {
    return runAction(
      courseId,
      () => deleteCourseAsAdmin(courseId),
      "deleted",
      "delete",
    );
  }

  function handleToggleFeatured(course: TeacherCourse) {
    const nextFeatured = !course.featured;
    return runAction(
      course.id,
      () => setCourseFeatured(course.id, nextFeatured),
      nextFeatured ? "featured" : "unfeatured",
      "feature",
    );
  }

  function countLabel(kind: "courses" | "modules" | "lessons", count: number) {
    return t(`${copy}.${kind}${count === 1 ? "One" : ""}`).replace("{count}", () => String(count));
  }

  return (
    <section className="rounded-[14px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
            {t(`${copy}.eyebrow`)}
          </p>
          <h3 className="mt-2 text-base font-semibold text-[var(--color-ink)]">
            {t(`${copy}.title`)}
          </h3>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
            {t(`${copy}.description`)}
          </p>
        </div>
        {!isLoading && !loadError ? <span className="rounded-[8px] bg-[var(--color-surface-soft)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-primary)]">{countLabel("courses", courses.length)}</span> : null}
      </div>

      {loadError ? <InlineAlert tone="error" className="mt-5">{t(`${copy}.loadError`)}</InlineAlert> : null}
      {error ? <InlineAlert tone="error" className="mt-5">{t(`${copy}.errors.${error}`)}</InlineAlert> : null}
      {success ? <InlineAlert tone="success" className="mt-5">{t(`${copy}.success.${success}`)}</InlineAlert> : null}

      <div className="mt-6 grid gap-3">
        {isLoading ? (
          <p role="status" className="text-sm text-[var(--color-ink-soft)]">
            {t(`${copy}.loading`)}
          </p>
        ) : courses.length === 0 ? (
          loadError ? null : <p className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-6 text-[var(--color-ink-soft)]">{t(`${copy}.empty`)}</p>
        ) : (
          courses.map((course) => (
            <article
              key={course.id}
              className="rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-words text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
                    {getCourseCategoryLabel(course.category, t)}
                  </p>
                  <h4 className="mt-2 break-words text-base font-semibold text-[var(--color-ink)]">
                    {course.title}
                  </h4>
                  <p className="mt-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
                    {countLabel("modules", course.modules?.length ?? 0)} - {countLabel("lessons", course.lessonCount ?? 0)}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <StatusChip status={course.status} />
                  {course.featured ? (
                    <span className="rounded-[8px] bg-[var(--color-primary)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-base)]">
                      {t(`${copy}.featured`)}
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
                        ? "button-outline min-h-11 px-3.5 py-2 text-xs disabled:opacity-60"
                        : "button-solid min-h-11 px-3.5 py-2 text-xs disabled:opacity-60"
                    }
                  >
                    {busyCourseId === course.id
                      ? t(`${copy}.working`)
                      : course.featured
                        ? t(`${copy}.unfeature`)
                        : t(`${copy}.feature`)}
                  </button>
                ) : null}
                {adminCanUnpublishCourse(course.status) ? (
                  <button
                    type="button"
                    onClick={() => handleUnpublish(course.id)}
                    disabled={busyCourseId === course.id}
                    className="button-outline min-h-11 px-3.5 py-2 text-xs disabled:opacity-60"
                  >
                    {t(`${copy}.${busyCourseId === course.id ? "working" : "unpublish"}`)}
                  </button>
                ) : null}
                {adminCanRepublishCourse(course.status) ? (
                  <button
                    type="button"
                    onClick={() => handleRepublish(course.id)}
                    disabled={busyCourseId === course.id}
                    className="button-solid min-h-11 px-3.5 py-2 text-xs disabled:opacity-60"
                  >
                    {t(`${copy}.${busyCourseId === course.id ? "working" : "republish"}`)}
                  </button>
                ) : null}
                {confirmingDeleteId === course.id ? (
                  <>
                    <button
                      type="button"
                      onClick={() => handleDelete(course.id)}
                      disabled={busyCourseId === course.id}
                      className="button-accent min-h-11 px-3.5 py-2 text-xs disabled:opacity-60"
                    >
                      {t(`${copy}.${busyCourseId === course.id ? "deleting" : "confirmDelete"}`)}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingDeleteId(null)}
                      disabled={busyCourseId === course.id}
                      className="button-outline min-h-11 px-3.5 py-2 text-xs disabled:opacity-60"
                    >
                      {t(`${copy}.cancel`)}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmingDeleteId(course.id)}
                    disabled={busyCourseId === course.id}
                    className="button-danger min-h-11 px-3.5 py-2 text-xs disabled:opacity-60"
                  >
                    {t(`${copy}.delete`)}
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
