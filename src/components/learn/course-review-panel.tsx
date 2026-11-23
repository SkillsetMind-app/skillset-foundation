"use client";

import { CheckCircle2, Star } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { InlineAlert } from "@/components/ui/inline-alert";
import { LoadErrorAlert } from "@/components/ui/load-error-alert";
import type { CourseReview } from "@/domain/course-review";
import {
  submitCourseReview,
  subscribeToUserCourseReview,
} from "@/lib/data/course-reviews";

type CourseReviewPanelProps = {
  courseId: string;
  progressPercent: number;
  /** A regra dos 50% so vale para curso com aula: comunidade, evento ao vivo,
   *  e-book e curso sem aula avaliam sem progresso (submit_course_review). */
  requiresProgress?: boolean;
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
  requiresProgress = true,
  previewMode = false,
}: CourseReviewPanelProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [existingReview, setExistingReview] = useState<CourseReview | null>(null);
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  // Sucesso e falha separados: antes eram o mesmo estado e a mesma pílula
  // navy, e "Review saved." tinha a cara de "We could not load your review.".
  const [saved, setSaved] = useState(false);
  // Chave do dicionário, nunca texto: o idioma pode trocar com o erro na tela.
  const [error, setError] = useState("");
  // A falha da leitura tem "Try again" (assina de novo), acima do formulário:
  // sem ela, as estrelas e o texto podem não ser a resenha já salva.
  const [loadFailed, setLoadFailed] = useState(false);
  const [reviewAttempt, setReviewAttempt] = useState(0);
  // O aviso fica, com o botão ocupado, até a releitura responder.
  const [reviewRetrying, setReviewRetrying] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const progressMissing = requiresProgress && progressPercent < 50;
  const canReview = !previewMode && !progressMissing && Boolean(user);

  useEffect(() => {
    if (!user || previewMode) {
      return;
    }

    return subscribeToUserCourseReview(
      courseId,
      user.uid,
      (review) => {
        setExistingReview(review);
        setLoadFailed(false);
        setReviewRetrying(false);
        if (review) {
          setRating(review.rating);
          setBody(review.body ?? "");
        }
      },
      () => {
        setLoadFailed(true);
        setReviewRetrying(false);
      },
    );
  }, [courseId, previewMode, user, reviewAttempt]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canReview) {
      return;
    }

    setIsSaving(true);
    setSaved(false);
    setError("");

    try {
      await submitCourseReview({ courseId, rating, body });
      setSaved(true);
    } catch (failure) {
      setError(reviewFailureKey(failure));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section ref={panelRef} tabIndex={-1} className="member-review-panel">
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

      {loadFailed ? (
        <LoadErrorAlert
          className="mt-5"
          focusRef={panelRef}
          busy={reviewRetrying}
          onRetry={() => {
            setReviewRetrying(true);
            setReviewAttempt((attempt) => attempt + 1);
          }}
        >
          {t("learn.classroom.review.loadError")}
        </LoadErrorAlert>
      ) : null}

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
          className="min-h-28 rounded-md border border-[var(--color-line)] bg-white px-4 py-3 text-sm leading-6 text-[var(--color-ink)] outline-none transition focus:border-[var(--color-primary)]"
          aria-label={t("learn.classroom.review.bodyLabel")}
          placeholder={t("learn.classroom.review.placeholder")}
        />

        {!canReview ? (
          <p className="rounded-md bg-white px-3 py-2 text-xs font-semibold leading-5 text-[var(--color-ink-soft)]">
            {previewMode
              ? t("learn.classroom.review.preview")
              : progressMissing
                ? t("learn.classroom.review.progressRequired")
                : t("learn.classroom.review.signIn")}
          </p>
        ) : null}

        {/* O padrão da casa: "salvou" ao lado do botão, numa região sempre
            montada (o botão não sai do lugar); a falha numa caixa de erro
            com ícone, embaixo dele. */}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={!canReview || isSaving}
            className="button-solid w-fit px-4 py-2.5 text-sm"
          >
            {isSaving
              ? t("learn.classroom.review.saving")
              : existingReview
                ? t("learn.classroom.review.update")
                : t("learn.classroom.review.submit")}
          </button>
          <span role="status" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-success-fg)]">
            {saved ? (
              <>
                <CheckCircle2 aria-hidden="true" size={16} />
                {t("learn.classroom.review.saved")}
              </>
            ) : null}
          </span>
        </div>

        {error ? <InlineAlert tone="error">{t(error)}</InlineAlert> : null}
      </form>
    </section>
  );
}
