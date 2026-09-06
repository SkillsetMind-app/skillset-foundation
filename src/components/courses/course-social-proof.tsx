"use client";

import { useTranslation } from "@/components/i18n/i18n-provider";

import Link from "next/link";
import { Star } from "lucide-react";
import { useEffect, useState } from "react";

import { UserAvatar } from "@/components/shared/user-avatar";
import type { CourseReview } from "@/domain/course-review";
import type { PublicProfile } from "@/domain/user-profile";
import { subscribeToCourseReviews } from "@/lib/data/course-reviews";
import { subscribeToPublicProfile } from "@/lib/data/user-profiles";

/**
 * Buyer-facing social proof for the public sales page.
 *
 * The review pipeline (submitCourseReview callable + aggregate rating on the
 * course doc) existed end-to-end, but no surface ever rendered the published
 * reviews — learners wrote them and buyers never saw them. Course sales pages
 * live or die on social proof (every major marketplace leads with it), so this
 * closes that loop with data the platform already collects.
 */

export function CourseReviewsSection({
  courseId,
  ratingAverage,
  ratingCount,
}: {
  courseId: string;
  ratingAverage?: number;
  ratingCount?: number;
}) {
  const { t, locale } = useTranslation();
  const [reviews, setReviews] = useState<CourseReview[]>([]);

  useEffect(() => {
    // Subscribe-only effect; errors degrade to an empty list (the section
    // simply doesn't render) rather than breaking the sales page.
    return subscribeToCourseReviews(
      courseId,
      setReviews,
      () => setReviews([]),
    );
  }, [courseId]);

  // No published reviews: render nothing. An empty "Reviews (0)" block reads
  // as a warning sign to buyers — absence is better than emptiness.
  if (reviews.length === 0) {
    return null;
  }

  const average =
    typeof ratingAverage === "number" && ratingAverage > 0
      ? ratingAverage
      : reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length;
  const count =
    typeof ratingCount === "number" && ratingCount > 0
      ? ratingCount
      : reviews.length;

  return (
    <section
      id="reviews"
      className="mt-8 scroll-mt-24 rounded-[16px] border border-[var(--color-line)] bg-white p-5 shadow-[var(--shadow-soft)]"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">{t("publicCourses.reviewsTitle")}</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span className="display-title text-4xl leading-none text-[var(--color-primary)]">
          {average.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
        </span>
        <div>
          <StarRow rating={average} />
          <p className="mt-1 text-xs font-semibold text-[var(--color-ink-soft)]">
            {t(count === 1 ? "publicCourses.reviewsOne" : "publicCourses.reviewsMany").replace("{count}", String(count))}
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-3">
        {reviews.map((review) => (
          <article
            key={review.id}
            className="rounded-[12px] border fine-rule bg-[var(--color-surface-soft)] p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-[var(--color-ink)]">
                {review.authorName || t("publicCourses.learner")}
              </p>
              <StarRow rating={review.rating} compact />
            </div>
            {review.body ? (
              <p className="mt-2 text-sm leading-6 text-[var(--color-ink-soft)]">
                {review.body}
              </p>
            ) : null}
            {formatReviewDate(review.updatedAt ?? review.createdAt, locale) ? (
              <p className="mt-2 text-xs text-[var(--color-ink-soft)]">
                {formatReviewDate(review.updatedAt ?? review.createdAt, locale)}
              </p>
            ) : null}
          </article>
        ))}
      </div>

      <p className="mt-4 text-xs leading-6 text-[var(--color-ink-soft)]">{t("publicCourses.reviewsPolicy")}</p>
    </section>
  );
}

/**
 * O perfil publico do professor, uma assinatura so por pagina.
 *
 * A pagina de venda usa o mesmo perfil em dois lugares (a assinatura embaixo do
 * titulo e o cartao do instrutor), e cada `subscribeToPublicProfile` abre um
 * canal realtime com o mesmo nome — dois deles brigariam pelo mesmo canal. Por
 * isso quem assina e a pagina, e o cartao recebe o perfil pronto.
 */
export function useInstructorProfile(teacherId: string): PublicProfile | null {
  const [profile, setProfile] = useState<PublicProfile | null>(null);

  useEffect(() => {
    if (!teacherId) return;
    return subscribeToPublicProfile(
      teacherId,
      setProfile,
      () => setProfile(null),
    );
  }, [teacherId]);

  return profile;
}

export function CourseInstructorCard({
  teacherId,
  profile,
}: {
  teacherId: string;
  profile: PublicProfile | null;
}) {
  const { t } = useTranslation();
  // Teachers without a published public profile simply don't get the card —
  // never fabricate instructor identity. (publicProfiles is projected by a
  // Cloud Function and anonymously readable.)
  if (!profile) {
    return null;
  }

  const name = profile.displayName || t("publicCourses.instructorFallback");

  return (
    <div className="rounded-[12px] border fine-rule bg-[var(--color-surface-soft)] p-4">
      <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">{t("publicCourses.yourInstructor")}</p>
      <div className="mt-3 flex items-center gap-3">
        <UserAvatar name={name} photoURL={profile.photoURL} size="sm" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--color-ink)]">
            {name}
          </p>
          {profile.credentials.length > 0 ? (
            <p className="truncate text-xs text-[var(--color-ink-soft)]">
              {profile.credentials[0]}
            </p>
          ) : profile.username ? (
            <p className="truncate text-xs text-[var(--color-ink-soft)]">
              @{profile.username}
            </p>
          ) : null}
        </div>
      </div>
      {profile.bio ? (
        <p className="mt-3 line-clamp-3 text-xs leading-5 text-[var(--color-ink-soft)]">
          {profile.bio}
        </p>
      ) : null}
      <Link
        href={`/instructors/${encodeURIComponent(teacherId)}`}
        className="mt-3 inline-flex text-xs font-semibold text-[var(--color-primary)] underline-offset-4 hover:underline"
      >{t("publicCourses.fullProfile")}</Link>
    </div>
  );
}

function StarRow({ rating, compact }: { rating: number; compact?: boolean }) {
  const { t, locale } = useTranslation();
  const size = compact ? 13 : 16;
  const rounded = Math.round(rating);

  return (
    <span
      className="inline-flex items-center gap-0.5"
      role="img"
      aria-label={t("publicCourses.rated").replace("{rating}", rating.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }))}
    >
      {[1, 2, 3, 4, 5].map((position) => (
        <Star
          key={position}
          aria-hidden="true"
          size={size}
          strokeWidth={1.5}
          className={
            position <= rounded
              ? "fill-[var(--color-brand)] text-[var(--color-brand)]"
              : "fill-transparent text-[var(--color-line)]"
          }
        />
      ))}
    </span>
  );
}

function formatReviewDate(value: unknown, locale: string): string | null {
  if (
    typeof value === "object"
    && value !== null
    && "toMillis" in value
    && typeof (value as { toMillis?: unknown }).toMillis === "function"
  ) {
    return new Intl.DateTimeFormat(locale, {
      month: "short",
      year: "numeric",
    }).format((value as { toMillis: () => number }).toMillis());
  }

  return null;
}
