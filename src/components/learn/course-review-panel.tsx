"use client";

import { Star } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { useAuth } from "@/components/auth/auth-provider";
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

export function CourseReviewPanel({
  courseId,
  progressPercent,
  previewMode = false,
}: CourseReviewPanelProps) {
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
        setMessage("We could not load your course review.");
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
      setMessage("Review saved. Thank you for rating this course.");
    } catch (error) {
      setMessage(
        error instanceof Error && error.message
          ? error.message
          : "We could not save your review. Try again.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="member-review-panel">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
          Course review
        </p>
        <h4 className="mt-2 text-lg font-semibold text-[var(--color-primary)]">
          Rate the learning experience.
        </h4>
        <p className="mt-2 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
          Reviews become part of the public course record after you have real
          learning progress. One review is allowed per enrolled account.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="mt-5 grid gap-4">
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Course rating">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={value === rating}
              onClick={() => setRating(value)}
              disabled={!canReview || isSaving}
              className={`member-review-star ${value <= rating ? "is-active" : ""}`}
              aria-label={`${value} star${value === 1 ? "" : "s"}`}
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
          placeholder="What should future learners know about this course?"
        />

        {!canReview ? (
          <p className="rounded-[10px] bg-white px-3 py-2 text-xs font-semibold leading-5 text-[var(--color-ink-soft)]">
            {previewMode
              ? "Preview mode cannot publish course reviews."
              : progressPercent < 50
                ? "Reviews open after you complete 50% of the course."
                : "Sign in to review this course."}
          </p>
        ) : null}

        {message ? (
          <p className="rounded-[10px] bg-white px-3 py-2 text-xs font-semibold leading-5 text-[var(--color-primary)]">
            {message}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={!canReview || isSaving}
          className="button-solid w-fit px-5 py-3 text-sm disabled:opacity-60"
        >
          {isSaving
            ? "Saving..."
            : existingReview
              ? "Update review"
              : "Submit review"}
        </button>
      </form>
    </section>
  );
}
