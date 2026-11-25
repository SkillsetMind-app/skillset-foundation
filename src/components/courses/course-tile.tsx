"use client";

import { getCourseCategoryLabel } from "@/lib/i18n/course-categories";

import { useTranslation } from "@/components/i18n/i18n-provider";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Star } from "lucide-react";
import type { ReactNode } from "react";

import { UserAvatar } from "@/components/shared/user-avatar";
import { VerifiedSeal } from "@/components/shared/verified-badge";
import type { CourseCard } from "@/lib/data/catalog";

/**
 * The ONLY badge on the card, and only when there is something to say.
 *
 * "Published" is gone: it is the internal state of the course, not purchase
 * information — every course in the catalog is published, so the badge separated nothing.
 */
export function courseCardBadge(card: CourseCard): string | null {
  if (card.featured) return "Featured (paid placement)";
  if (card.freePreviewHref) return "Free preview";
  if (!card.ratingCount) return "New";
  return null;
}

/**
 * The course card. ONE only, for the three screens that show courses in a list:
 * home (FeaturedCourses), catalog (CourseMarketplace) and teacher storefront
 * (InstructorProfileView).
 *
 * Before, there were three different designs for the same thing: on home the whole
 * card was a link, in the catalog only the button navigated (and the price appeared two
 * times, with two badges and two buttons of different sizes), in the storefront only the
 * cover navigated. Whoever looked for a course learned to click in three different
 * places depending on the page.
 *
 * Rules the component guarantees:
 * - the whole card is a link (stretched link from the title);
 * - the price appears ONCE, in the footer;
 * - at most ONE badge, and only when there is something to say;
 * - summary cut to two lines on any screen.
 */
export type CourseTileProps = {
  courseData?: Pick<CourseCard, "lessonCount" | "priceAmountMinor" | "currency" | "freePreviewHref" | "ratingCount" | "ownerId" | "featured">;
  href: string;
  title: string;
  image: string;
  summary?: string;
  /** Category and short data: they become the line "Category · 8 lessons". */
  category?: string;
  meta?: string;
  /** At most one. "Published" is not a badge: it is internal vocabulary. */
  badge?: string | null;
  priceLabel?: string;
  rating?: { average: number; count: number } | null;
  /** `verified`: only the badge, no popover (the whole card is already a link). */
  instructor?: { name: string; photoURL?: string | null; verified?: boolean } | null;
  actionLabel?: string;
  /** Save button and the like. It sits above the stretched link by z-index. */
  overlay?: ReactNode;
  imageSizes?: string;
  className?: string;
};

export function CourseTile({
  courseData,
  href,
  title,
  image,
  summary,
  category,
  meta,
  badge,
  priceLabel,
  rating,
  instructor,
  actionLabel,
  overlay,
  imageSizes = "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw",
  className = "",
}: CourseTileProps) {
  const { t, locale } = useTranslation();
  const displayMeta = typeof courseData?.lessonCount === "number"
    ? t(courseData.lessonCount === 1 ? "publicCourses.lessonOne" : "publicCourses.lessonMany").replace("{count}", String(courseData.lessonCount))
    : meta;
  const displayPrice = typeof courseData?.priceAmountMinor === "number"
    ? new Intl.NumberFormat(locale, { style: "currency", currency: courseData.currency ?? "USD" }).format(courseData.priceAmountMinor / 100)
    : courseData?.ownerId ? t("publicCourses.enrollmentSoon") : priceLabel;
  // A featured placement bought with the plan comes before everything: whoever buys needs to know
  // that this position in the list was paid for (the single badge is still just one).
  const displayBadge = courseData
    ? courseData.featured ? t("publicCourses.featuredPaid") : courseData.freePreviewHref ? t("publicCourses.preview") : !courseData.ratingCount ? t("publicCourses.new") : null
    : badge;
  const kicker = [category ? getCourseCategoryLabel(category, t) : category, displayMeta].filter(Boolean).join(" · ");
  const hasRating = Boolean(rating && rating.count > 0);

  return (
    <article className={`marketplace-card group ${className}`.trim()}>
      <div className="marketplace-card__media">
        <Image
          src={image}
          alt=""
          fill
          sizes={imageSizes}
          className="object-cover"
        />
        <div className="marketplace-card__scrim" />
        {displayBadge ? (
          <div className="marketplace-card__badges">
            <span className="marketplace-card__tag">{displayBadge}</span>
          </div>
        ) : null}
        {overlay}
      </div>
      <div className="marketplace-card__body">
        {kicker ? (
          <span className="marketplace-card__kicker">{kicker}</span>
        ) : null}
        <h3 className="marketplace-card__title">
          <Link href={href} className="marketplace-card__link">
            {title}
          </Link>
        </h3>
        {summary ? (
          <p className="marketplace-card__summary">{summary}</p>
        ) : null}
        {instructor || hasRating ? (
          <p className="marketplace-card__instructor">
            {instructor ? (
              <>
                <UserAvatar
                  name={instructor.name}
                  photoURL={instructor.photoURL}
                  size="sm"
                  className="size-6"
                />
                <span className="min-w-0 truncate">{instructor.name}</span>
                {instructor.verified ? (
                  <VerifiedSeal size={12} label={t("verifiedBadge.label")} />
                ) : null}
              </>
            ) : null}
            {hasRating && rating ? (
              <span className="inline-flex shrink-0 items-center gap-1 text-[var(--color-primary)]">
                <Star
                  aria-hidden="true"
                  size={13}
                  strokeWidth={1.5}
                  className="fill-[var(--color-brand)] text-[var(--color-brand)]"
                />
                {rating.average.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                <span className="font-normal text-[var(--color-ink-soft)]">
                  ({rating.count})
                </span>
              </span>
            ) : null}
          </p>
        ) : null}
        <div className="marketplace-card__footer">
          {displayPrice ? (
            <span className="marketplace-card__price">{displayPrice}</span>
          ) : (
            <span />
          )}
          <span className="marketplace-card__cta">
            {actionLabel ?? t("publicCourses.viewCourse")}
            <ArrowRight
              aria-hidden="true"
              size={14}
              strokeWidth={2}
              className="transition-transform duration-200 group-hover:translate-x-1"
            />
          </span>
        </div>
      </div>
    </article>
  );
}
