"use client";

import { useEffect, useMemo, useState } from "react";

import { ExportTableButton } from "@/components/shared/export-table-button";
import type { TeacherCourse } from "@/domain/teacher-course";
import {
  subscribeToCoursesInReview,
  updateCourseReviewStatus,
} from "@/lib/data/teacher-courses";

type ReviewAction = "published" | "needs_changes" | "inactive";

const actionLabels: Record<ReviewAction, string> = {
  published: "Approve and publish",
  needs_changes: "Request changes",
  inactive: "Mark inactive",
};

const defaultReviewNotes: Record<ReviewAction, string> = {
  published: "Approved for marketplace publishing.",
  needs_changes: "",
  inactive: "Kept inactive by Skillset review.",
};

function formatTeacherCoursePrice(course: TeacherCourse): string {
  if (
    course.paymentType === "free"
    || (typeof course.priceAmountMinor === "number" && course.priceAmountMinor === 0)
  ) {
    return "Free";
  }

  if (typeof course.priceAmountMinor !== "number") {
    return "Pricing pending";
  }

  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: course.currency ?? "USD",
  }).format(course.priceAmountMinor / 100);
}

function getReviewReadiness(course: TeacherCourse) {
  const hasStructure = (course.modules?.length ?? 0) > 0 && (course.lessonCount ?? 0) > 0;
  const hasPreview = Boolean(course.freePreviewLessonId);
  const isFreeCourse =
    course.paymentType === "free"
    || (typeof course.priceAmountMinor === "number" && course.priceAmountMinor === 0);
  const hasPaidPrice =
    course.paymentType !== "free"
    && typeof course.priceAmountMinor === "number"
    && course.priceAmountMinor > 0;
  const hasEnrollmentModel = isFreeCourse || hasPaidPrice;

  return {
    canApprove: hasStructure && hasEnrollmentModel,
    checks: [
      hasStructure ? "Course structure ready" : "Missing course structure",
      hasPreview ? "Free preview selected" : "No preview selected",
      hasEnrollmentModel
        ? `Enrollment model: ${formatTeacherCoursePrice(course)}`
        : "Set a paid price greater than $0, or mark the course as Free",
    ],
  };
}

export function CourseReviewQueue() {
  const [courses, setCourses] = useState<TeacherCourse[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [activeCourseId, setActiveCourseId] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    return subscribeToCoursesInReview(
      (nextCourses) => {
        setCourses(nextCourses);
        setIsLoading(false);
      },
      () => {
        setError("We could not load courses waiting for review.");
        setIsLoading(false);
      },
    );
  }, []);
  const exportRows = useMemo(
    () =>
      courses.map((course) => ({
        id: course.id,
        title: course.title,
        category: course.category,
        status: course.status,
        modules: course.modules?.length ?? 0,
        lessons: course.lessonCount ?? 0,
        price: formatTeacherCoursePrice(course),
        ownerId: course.ownerId,
      })),
    [courses],
  );

  async function handleReview(courseId: string, action: ReviewAction) {
    const note = reviewNotes[courseId]?.trim() ?? "";

    if (action === "needs_changes" && note.length < 12) {
      setError("Add a clear review note before requesting changes.");
      return;
    }

    setError("");
    setSuccess("");
    setActiveCourseId(courseId);

    try {
      await updateCourseReviewStatus(
        courseId,
        action,
        note || defaultReviewNotes[action],
      );
      setSuccess(
        action === "published"
          ? "Course approved and published."
          : action === "needs_changes"
            ? "Course returned to the teacher for updates."
            : "Course marked inactive.",
      );
    } catch {
      setError("We could not update this course review. Please try again.");
    } finally {
      setActiveCourseId(null);
    }
  }

  return (
    <section className="rounded-[4px] border border-[var(--color-line)] bg-white p-4 sm:p-6 shadow-[var(--shadow-soft)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-[var(--color-brand)]">
            Course review queue
          </p>
          <h3 className="display-title mt-3 text-3xl text-[var(--color-ink)]">
            Courses waiting for Skillset approval
          </h3>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
            Review the course structure, then approve it for the marketplace,
            return it for changes, or keep it inactive.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportTableButton filename="skillset-course-review" rows={exportRows} />
          <span className="rounded-[8px] bg-[var(--color-surface-soft)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-primary)]">
            {courses.length} pending
          </span>
        </div>
      </div>

      {error ? (
        <p className="mt-5 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-accent-fg)]">
          {error}
        </p>
      ) : null}

      {success ? (
        <p className="mt-5 rounded-[10px] border border-[rgba(26,54,93,0.12)] bg-[var(--color-surface-soft)] px-4 py-3 text-sm font-semibold text-[var(--color-primary)]">
          {success}
        </p>
      ) : null}

      <div className="mt-6 grid gap-3">
        {isLoading ? (
          <p className="text-sm text-[var(--color-ink-soft)]">Loading review queue...</p>
        ) : courses.length === 0 ? (
          <p className="rounded-[3px] border fine-rule bg-[var(--color-surface-soft)] p-4 text-sm leading-6 text-[var(--color-ink-soft)]">
            No courses are waiting for review right now.
          </p>
        ) : (
          courses.map((course) => {
            const readiness = getReviewReadiness(course);

            return (
              <article
                key={course.id}
                className="rounded-[4px] border fine-rule bg-[var(--color-surface-soft)] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
                      {course.category}
                    </p>
                    <h4 className="mt-2 text-base font-semibold text-[var(--color-ink)]">
                      {course.title}
                    </h4>
                  </div>
                  <span className="rounded-[8px] bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-primary)]">
                    {course.modules?.length ?? 0} modules / {course.lessonCount ?? 0} lessons
                  </span>
                </div>
                <p className="mt-3 text-sm leading-6 text-[var(--color-ink-soft)]">
                  {course.summary}
                </p>
                <div className="mt-4 grid gap-2 rounded-[3px] border fine-rule bg-white p-4">
                  {readiness.checks.map((check) => (
                    <p
                      key={check}
                      className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-soft)]"
                    >
                      {check}
                    </p>
                  ))}
                </div>
                <label className="mt-4 grid gap-2 text-sm font-semibold text-[var(--color-ink)]">
                  Review note to teacher
                  <textarea
                    value={reviewNotes[course.id] ?? ""}
                    onChange={(event) =>
                      setReviewNotes((currentNotes) => ({
                        ...currentNotes,
                        [course.id]: event.target.value,
                      }))
                    }
                    rows={3}
                    placeholder="Example: Add a clearer outcome to module 1 and attach the first lesson material before publishing."
                    className="resize-none rounded-[10px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm font-normal outline-none focus:border-[var(--color-primary-light)]"
                  />
                  <span className="text-xs font-normal leading-5 text-[var(--color-ink-soft)]">
                    Required when requesting changes. Optional when approving.
                  </span>
                </label>
                <div className="mt-4 flex flex-wrap gap-2">
                  {(Object.keys(actionLabels) as ReviewAction[]).map((action) => (
                    <button
                      key={action}
                      type="button"
                      onClick={() => handleReview(course.id, action)}
                      disabled={
                        activeCourseId === course.id
                        || (action === "published" && !readiness.canApprove)
                      }
                      className={
                        action === "published"
                          ? "button-solid px-4 py-2 text-xs disabled:opacity-60"
                          : "button-outline px-4 py-2 text-xs disabled:opacity-60"
                      }
                    >
                      {activeCourseId === course.id ? "Updating..." : actionLabels[action]}
                    </button>
                  ))}
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
