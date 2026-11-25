"use client";

import { ArrowRight, Star } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useTransition, type CSSProperties } from "react";

import { CourseTile } from "@/components/courses/course-tile";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { UserAvatar } from "@/components/shared/user-avatar";
import { SelfReportedTag, VerifiedBadge } from "@/components/shared/verified-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadErrorAlert } from "@/components/ui/load-error-alert";
import { brand } from "@/data/brand";
import {
  isStorefrontHexColor,
  publicProfileName,
  readableTextOnAccent,
  type PublicProfile,
  type StorefrontShowcase,
} from "@/domain/user-profile";
import type { CreatorCourse } from "@/lib/data/server/public-profile";

/**
 * The teacher's public profile as a bio link: a single phone column, in the
 * order header → ONE main button → courses in rows → proof → about.
 *
 * The data arrives ready from the server (page.tsx). Nothing here leads away from the
 * teacher: no "explore the marketplace", no link to /courses — the
 * visitor came from their Instagram and only leaves here for one of their courses.
 *
 * Social networks (Instagram, site...) come later: public_profiles still
 * does not store those fields.
 */
export function InstructorProfileView({
  profile,
  courses,
}: {
  profile: PublicProfile;
  /** null = the courses read failed (the profile stays up). */
  courses: CreatorCourse[] | null;
}) {
  const { t, locale } = useTranslation();
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const coursesRef = useRef<HTMLElement>(null);
  const name = publicProfileName(profile)
    ?? t("publicPages.profile.fallback_name").replace("{brand}", () => brand.name);
  const showcase = profile.storefront?.showcase;
  const branding = profile.storefront?.branding;
  const tagline = showcase?.tagline?.trim();
  // The projection already sanitizes; a second cheap lock before it becomes CSS.
  const accent = branding?.accentColor && isStorefrontHexColor(branding.accentColor)
    ? branding.accentColor
    : null;
  const ordered = orderShowcaseCourses(courses ?? [], showcase);
  const primary = ordered[0];
  // A long bio opens collapsed; a short one shows in full, with no button.
  const longBio = (profile.bio?.length ?? 0) > BIO_PREVIEW_CHARS;
  // The storefront theme (warm/cool/mono) tints the header; "default" does not.
  const theme = branding?.themePreset && branding.themePreset !== "default" ? branding.themePreset : null;
  const ratingCount = ordered.reduce((sum, course) => sum + course.ratingCount, 0);
  const ratingAverage = ratingCount
    ? ordered.reduce((sum, course) => sum + course.ratingAverage * course.ratingCount, 0) / ratingCount
    : 0;
  const decimal = (value: number) =>
    value.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  return (
    // minmax(0,1fr): without this the column takes the width of the main button's
    // title (truncate = no wrap) and .page-shell cuts off the rest.
    <article className="grid grid-cols-[minmax(0,1fr)] gap-8">
      <header
        data-section="header"
        data-storefront-theme={theme ?? undefined}
        className={`creator-profile-header flex flex-col items-center text-center ${theme ? "rounded-lg px-4 py-6" : ""}`}
      >
        {branding?.heroImageUrl ? (
          <div className="relative mb-6 aspect-[3/1] w-full overflow-hidden rounded-lg bg-[var(--color-surface-strong)]">
            <Image
              src={branding.heroImageUrl}
              alt=""
              fill
              priority
              sizes="(max-width: 640px) 100vw, 640px"
              className="object-cover"
              // The teacher's host, outside remotePatterns.
              unoptimized
            />
          </div>
        ) : null}
        <UserAvatar name={name} photoURL={profile.photoURL} size="lg" />
        {/* flex-wrap: a long name on a phone pushes the badge to the next line
            instead of running off the screen. */}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
          <h1 className="display-title text-3xl leading-tight text-[var(--color-primary)] sm:text-4xl">
            {name}
          </h1>
          {profile.verification ? <VerifiedBadge verification={profile.verification} /> : null}
        </div>
        {profile.username ? (
          <p className="mt-1 text-sm font-semibold text-[var(--color-ink-soft)]">@{profile.username}</p>
        ) : null}
        {tagline ? (
          // The teacher's brand color (storefront plan) becomes the line above.
          <p
            className={`mt-3 max-w-md text-base font-semibold leading-6 text-[var(--color-primary)] ${accent ? "border-t-2 pt-3" : ""}`}
            style={accent ? { borderColor: accent } : undefined}
          >
            {tagline}
          </p>
        ) : null}
      </header>

      {primary ? (
        <Link
          data-section="primary"
          href={primary.href}
          // The teacher's brand color on the button; the text follows the contrast.
          data-accent={accent ? "" : undefined}
          style={accent ? ({
            "--storefront-accent": accent,
            "--storefront-accent-ink": readableTextOnAccent(accent),
          } as CSSProperties) : undefined}
          className="button-solid min-h-12 w-full min-w-0 px-5 py-3 text-base"
        >
          <span className="min-w-0 truncate">{primary.title}</span>
          <ArrowRight aria-hidden="true" size={18} strokeWidth={2} className="shrink-0" />
        </Link>
      ) : null}

      <section ref={coursesRef} tabIndex={-1} data-section="courses" aria-labelledby="creator-courses-heading">
        <h2
          id="creator-courses-heading"
          className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--color-accent-fg)]"
        >
          {t("publicPages.profile.courses_heading")}
        </h2>
        {courses === null ? (
          // The courses arrive from the server: "Try again" asks for the page again
          // (router.refresh), without reloading the browser or losing the scroll.
          <LoadErrorAlert
            className="mt-4"
            focusRef={coursesRef}
            busy={refreshing}
            onRetry={() => startRefresh(() => router.refresh())}
          >
            {t("publicPages.profile.courses_error")}
          </LoadErrorAlert>
        ) : ordered.length === 0 ? (
          // The platform's empty state; an h3 under the h2 "Courses".
          <EmptyState
            as="h3"
            className="mt-4"
            title={t("publicPages.profile.no_public_courses_yet")}
            description={t("publicPages.profile.this_instructor_s_first_courses_will")}
          />
        ) : (
          <ul className="mt-4 grid gap-3">
            {ordered.map((course) => (
              <li key={course.id}>
                <CourseTile
                  href={course.href}
                  title={course.title}
                  image={course.coverImageUrl || "/brand/logo-mark.png"}
                  priceLabel={formatPrice(course, t, locale)}
                  rating={course.ratingCount ? { average: course.ratingAverage, count: course.ratingCount } : null}
                  className="marketplace-card--row"
                  imageSizes="96px"
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Proof only with a real number: zero does not appear. Only the rating: the
          course's enrollment counter is not maintained by anything in the database. */}
      {ratingCount > 0 ? (
        <dl
          data-section="proof"
          className="flex justify-center border-y border-[var(--color-line)] py-4 text-center"
        >
          <dt className="sr-only">{t("publicPages.profile.rating_label")}</dt>
          <dd className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-ink)]">
            <Star
              aria-hidden="true"
              size={14}
              strokeWidth={1.5}
              className="fill-[var(--color-brand)] text-[var(--color-brand)]"
            />
            {decimal(ratingAverage)}
            <span className="font-normal text-[var(--color-ink-soft)]">
              {t(ratingCount === 1 ? "publicPages.profile.ratings_one" : "publicPages.profile.ratings_many")
                .replace("{count}", () => ratingCount.toLocaleString(locale))}
            </span>
          </dd>
        </dl>
      ) : null}

      {profile.bio || profile.credentials.length > 0 ? (
        <section data-section="about" aria-labelledby="creator-about-heading">
          <h2
            id="creator-about-heading"
            className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--color-accent-fg)]"
          >
            {t("publicPages.profile.about").replace("{name}", () => name)}
          </h2>
          {profile.bio ? (
            // A long bio collapsed (someone arriving from Instagram wants the course). Without JS:
            // the <details> opens on its own and the CSS (.creator-bio) releases the text.
            <div className="creator-bio mt-3">
              <p className={`creator-bio__text text-sm leading-6 text-[var(--color-ink-soft)] ${longBio ? "line-clamp-3" : ""}`}>
                {profile.bio}
              </p>
              {longBio ? (
                <details>
                  <summary className="mt-1 inline-block cursor-pointer list-none text-sm font-semibold text-[var(--color-primary)] underline underline-offset-4">
                    {t("publicPages.profile.read_more")}
                  </summary>
                </details>
              ) : null}
            </div>
          ) : null}
          {profile.credentials.length > 0 ? (
            <ul className="mt-4 grid gap-2">
              {profile.credentials.map((credential, index) => (
                <li
                  key={`${profile.uid}-credential-${index}`}
                  className="border-l-2 border-[var(--color-line-strong)] pl-3 text-sm leading-6 text-[var(--color-ink-soft)]"
                >
                  {credential}
                  {profile.verification ? null : <SelfReportedTag />}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </article>
  );
}

/** Above this the bio opens collapsed to 3 lines, with "Read more". */
const BIO_PREVIEW_CHARS = 180;

/**
 * Storefront order: the featured course first, then the editor's order.
 * Without a position, it keeps the order it arrived in (alphabetical), at the end — the same
 * `?? MAX_SAFE_INTEGER` convention as the marketplace for a null `featured_rank`.
 */
function orderShowcaseCourses(
  courses: CreatorCourse[],
  showcase: StorefrontShowcase | null | undefined,
): CreatorCourse[] {
  const featuredId = showcase?.featuredCourseId ?? null;
  const orderedIds = showcase?.orderedCourseIds ?? [];

  if (!featuredId && orderedIds.length === 0) {
    return courses;
  }

  const rank = new Map(orderedIds.map((id, index) => [id, index]));

  return [...courses].sort((a, b) => {
    if (a.id === featuredId) return -1;
    if (b.id === featuredId) return 1;
    return (
      (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
      (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER)
    );
  });
}

function formatPrice(course: CreatorCourse, t: (key: string) => string, locale: string): string {
  if (course.free) {
    return t("publicPages.profile.free");
  }

  if (typeof course.priceAmountMinor === "number") {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: course.currency,
    }).format(course.priceAmountMinor / 100);
  }

  return t("publicPages.profile.enrollment_soon");
}
