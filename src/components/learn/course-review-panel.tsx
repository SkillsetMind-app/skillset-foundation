"use client";

import { Star } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import type { CourseReview } from "@/domain/course-review";
import {
  submitCourseReview,
  subscribeToUserCourseReview,
} from "@/lib/data/course-reviews";

type CourseReviewPanelProps = {
  courseId: string;
  progressPercent: number;
  previewMode?: boolean;
};

// The RPC may reject with a plain Supabase error object. Keep only known public
// reasons in UI state so a later locale change translates the same failure.
const reviewFailureKeys = new Map([
  ["Sign in before reviewing a course.", "signIn"],
  ["A valid course id is required.", "invalidCourse"],
  ["Rating must be between 1 and 5.", "invalidRating"],
  ["Review text must be at least 3 characters when provided.", "shortBody"],
  ["Course not found.", "courseMissing"],
  ["Only published courses can receive reviews.", "courseNotPublished"],
  ["Enroll in this course before leaving a review.", "enrollFirst"],
  ["You can only review courses attached to your account.", "wrongAccount"],
  ["This enrollment cannot leave a review.", "inactiveEnrollment"],
  ["Complete at least 50% of the course before leaving a review.", "progressRequired"],
  ["RATE_LIMIT", "rateLimit"],
  ["RATE_LIMIT: too many attempts, please wait before trying again", "rateLimit"],
]);

function reviewFailureKey(error: unknown): string {
  const message = error && typeof error === "object" && "message" in error ? error.message : null;
  const key = typeof message === "string" ? reviewFailureKeys.get(message) : undefined;
  return `learn.classroom.review.${key ?? "saveError"}`;
}

export function CourseReviewPanel({
  courseId,
  progressPercent,
  previewMode = false,
}: CourseReviewPanelProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [existingReview, setExistingReview] = useState<CourseReview | null>(null);
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const canReview = !previewMode && progressPercent >= 50 && Boolean(user);

  useEffect(() => {
    if (!user || previewMode) {
      return;
    }

    return subscribeToUserCourseReview(
      courseId,
      user.uid,
      (review) => {
        setExistingReview(review);
        if (review) {
          setRating(review.rating);
          setBody(review.body ?? "");
        }
      },
      () => {
        setMessage("learn.classroom.review.loadError");
      },
    );
  }, [courseId, previewMode, user]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canReview) {
      return;
    }

    setIsSaving(true);
    setMessage("");

    try {
      await submitCourseReview({ courseId, rating, body });
      setMessage("learn.classroom.review.saved");
    } catch (error) {
      setMessage(reviewFailureKey(error));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="member-review-panel">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
          {t("learn.classroom.review.title")}
        </p>
        <h4 className="mt-2 text-lg font-semibold text-[var(--color-primary)]">
          {t("learn.classroom.review.heading")}
        </h4>
        <p className="mt-2 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
          {t("learn.classroom.review.description")}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="mt-5 grid gap-4">
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("learn.classroom.review.rating")}>
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={value === rating}
              onClick={() => setRating(value)}
              disabled={!canReview || isSaving}
              className={`member-review-star ${value <= rating ? "is-active" : ""}`}
              aria-label={t(`learn.classroom.review.${value === 1 ? "starOne" : "starMany"}`).replace("{count}", () => String(value))}
            >
              <Star aria-hidden="true" size={18} fill="currentColor" />
            </button>
          ))}
        </div>

        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          disabled={!canReview || isSaving}
          maxLength={1200}
          rows={4}
          className="min-h-28 rounded-[12px] border border-[var(--color-line)] bg-white px-4 py-3 text-sm leading-6 text-[var(--color-ink)] outline-none transition focus:border-[var(--color-primary)]"
          aria-label={t("learn.classroom.review.bodyLabel")}
          placeholder={t("learn.classroom.review.placeholder")}
        />

        {!canReview ? (
          <p className="rounded-[10px] bg-white px-3 py-2 text-xs font-semibold leading-5 text-[var(--color-ink-soft)]">
            {previewMode
              ? t("learn.classroom.review.preview")
              : progressPercent < 50
                ? t("learn.classroom.review.progressRequired")
                : t("learn.classroom.review.signIn")}
          </p>
        ) : null}

        {message ? (
          <p className="rounded-[10px] bg-white px-3 py-2 text-xs font-semibold leading-5 text-[var(--color-primary)]">
            {t(message)}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={!canReview || isSaving}
          className="button-solid w-fit px-4 py-2.5 text-sm disabled:opacity-60"
        >
          {isSaving
            ? t("learn.classroom.review.saving")
            : existingReview
              ? t("learn.classroom.review.update")
              : t("learn.classroom.review.submit")}
        </button>
      </form>
    </section>
  );
}
