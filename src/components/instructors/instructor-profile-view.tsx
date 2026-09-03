"use client";

import { ArrowRight, BookOpen, GraduationCap, Star } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { type CSSProperties, useEffect, useMemo, useState } from "react";

import { CourseTile } from "@/components/courses/course-tile";
import { UserAvatar } from "@/components/shared/user-avatar";
import { brand } from "@/data/brand";
import type { TeacherCourse } from "@/domain/teacher-course";
import type { PublicProfile, StorefrontShowcase } from "@/domain/user-profile";
import { isStorefrontHexColor } from "@/domain/user-profile";
import {
  isInternalSmokeCourse,
  subscribeToPublishedTeacherCoursesByOwner,
} from "@/lib/data/published-courses";
import { subscribeToPublicProfile } from "@/lib/data/user-profiles";
import { getSupabaseClientConfig } from "@/lib/supabase/config";

export function InstructorProfileView({ uid }: { uid: string }) {
  const hasSupabaseConfig = Boolean(getSupabaseClientConfig());
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [courses, setCourses] = useState<TeacherCourse[]>([]);
  const [isProfileLoading, setIsProfileLoading] = useState(hasSupabaseConfig);
  const [areCoursesLoading, setAreCoursesLoading] = useState(hasSupabaseConfig);
  const [hasProfileError, setHasProfileError] = useState(!hasSupabaseConfig);
  const [coursesError, setCoursesError] = useState(
    hasSupabaseConfig ? "" : "Instructor courses could not load right now.",
  );

  useEffect(() => {
    if (!hasSupabaseConfig) {
      return;
    }

    const unsubscribeProfile = subscribeToPublicProfile(
      uid,
      (next) => {
        setProfile(next);
        setHasProfileError(false);
        setIsProfileLoading(false);
      },
      () => {
        setHasProfileError(true);
        setIsProfileLoading(false);
      },
    );

    const unsubscribeCourses = subscribeToPublishedTeacherCoursesByOwner(
      uid,
      (nextCourses) => {
        setCourses(nextCourses.filter((course) => !isInternalSmokeCourse(course)));
        setCoursesError("");
        setAreCoursesLoading(false);
      },
      () => {
        setCoursesError("Instructor courses could not load right now.");
        setAreCoursesLoading(false);
      },
    );

    return () => {
      unsubscribeProfile();
      unsubscribeCourses();
    };
  }, [hasSupabaseConfig, uid]);

  const stats = useMemo(() => getInstructorStats(courses), [courses]);
  const showcase = profile?.storefront?.showcase;
  const orderedCourses = useMemo(
    () => orderShowcaseCourses(courses, showcase),
    [courses, showcase],
  );

  if (isProfileLoading) {
    return <InstructorProfileSkeleton />;
  }

  if (hasProfileError || !profile) {
    return (
      <section className="rounded-[18px] border border-dashed border-[rgba(26,54,93,0.18)] bg-[var(--color-surface-soft)] p-10 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
          Profile unavailable
        </p>
        <h1 className="display-title mt-4 text-3xl leading-tight text-[var(--color-primary)]">
          This instructor profile isn&apos;t available.
        </h1>
        <p className="mx-auto mt-4 max-w-md text-sm leading-7 text-[var(--color-ink-soft)]">
          The instructor may not have published a profile yet. Explore the
          marketplace to discover available courses.
        </p>
        <div className="mt-7">
          <Link href="/courses" className="button-solid px-4 py-2.5 text-sm">
            Browse the marketplace
          </Link>
        </div>
      </section>
    );
  }

  const name = profile.displayName || profile.username || `${brand.name} instructor`;
  const branding = profile.storefront?.branding;
  // The projection already sanitizes these, but the accent lands in a CSS
  // custom property — cheapest possible second gate, reusing the domain rule.
  const accentColor =
    branding?.accentColor && isStorefrontHexColor(branding.accentColor)
      ? branding.accentColor
      : null;
  const tagline = showcase?.tagline?.trim();

  return (
    <>
      <section
        className="instructor-storefront-hero"
        data-storefront-theme={branding?.themePreset ?? "default"}
        style={
          accentColor
            ? ({ "--storefront-accent": accentColor } as CSSProperties)
            : undefined
        }
      >
        {branding?.heroImageUrl ? (
          <div className="instructor-storefront-hero__cover">
            <Image
              src={branding.heroImageUrl}
              alt=""
              fill
              sizes="100vw"
              className="object-cover"
              // Teacher-supplied host; not in next.config remotePatterns.
              unoptimized
            />
          </div>
        ) : null}
        <div className="instructor-storefront-hero__band">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              {branding?.logoUrl ? (
                <Image
                  src={branding.logoUrl}
                  alt={name}
                  width={28}
                  height={28}
                  className="h-7 w-auto object-contain"
                  unoptimized
                />
              ) : null}
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
                Instructor storefront
              </p>
            </div>
            <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-center">
              <UserAvatar name={name} photoURL={profile.photoURL} size="lg" />
              <div className="min-w-0">
                <h1 className="display-title text-4xl leading-tight text-[var(--color-primary)] sm:text-5xl">
                  {name}
                </h1>
                {profile.username ? (
                  <p className="mt-2 text-sm font-bold text-[var(--color-ink-soft)]">
                    @{profile.username}
                  </p>
                ) : null}
              </div>
            </div>

            {tagline ? (
              <p className="instructor-storefront-tagline mt-6 max-w-3xl">
                {tagline}
              </p>
            ) : null}

            {profile.bio ? (
              <p className="mt-6 max-w-3xl text-sm leading-7 text-[var(--color-ink-soft)]">
                {profile.bio}
              </p>
            ) : (
              <p className="mt-6 max-w-3xl text-sm leading-7 text-[var(--color-ink-soft)]">
                This instructor has published a reviewed public profile on{" "}
                {brand.name}. Their course catalog appears below as it goes live.
              </p>
            )}

            <div className="mt-7 flex flex-wrap gap-3">
              <a href="#courses" className="button-solid px-4 py-2.5 text-sm">
                View courses
              </a>
              <Link href="/courses" className="button-outline px-4 py-2.5 text-sm">
                Browse marketplace
              </Link>
            </div>
          </div>

          <aside className="instructor-storefront-metrics">
            <InstructorMetric
              icon={BookOpen}
              label="Published courses"
              value={String(stats.courseCount)}
            />
            <InstructorMetric
              icon={GraduationCap}
              label="Lessons"
              value={String(stats.lessonCount)}
            />
            <InstructorMetric
              icon={Star}
              label="Categories"
              value={String(stats.categoryCount)}
            />
          </aside>
        </div>

        {profile.credentials.length > 0 ? (
          <div className="border-t border-[var(--color-line)] p-6 sm:p-8 lg:p-10">
            <p className="text-sm font-bold text-[var(--color-ink)]">
              Background &amp; credentials
            </p>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {profile.credentials.map((credential, index) => (
                <li
                  key={`${profile.uid}-credential-${index}`}
                  className="rounded-[12px] border fine-rule bg-[var(--color-surface-soft)] px-4 py-3 text-sm leading-6 text-[var(--color-ink-soft)]"
                >
                  {credential}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section id="courses" className="mt-10" aria-labelledby="instructor-courses-heading">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
              Course catalog
            </p>
            <h2
              id="instructor-courses-heading"
              className="display-title mt-2 text-3xl text-[var(--color-primary)] sm:text-4xl"
            >
              Courses by {name}
            </h2>
          </div>
          {courses.length > 0 ? (
            <Link
              href="/courses"
              className="inline-flex items-center gap-2 text-sm font-bold text-[var(--color-primary)] underline-offset-4 hover:underline"
            >
              Browse all courses
              <ArrowRight aria-hidden="true" size={16} strokeWidth={1.9} />
            </Link>
          ) : null}
        </div>

        {coursesError ? (
          <p className="mt-6 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-danger-fg)]">
            {coursesError}
          </p>
        ) : null}

        {areCoursesLoading ? (
          <InstructorCourseSkeleton />
        ) : courses.length === 0 ? (
          <div className="mt-6 rounded-[18px] border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface-soft)] p-8 text-center">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
              No public courses yet
            </p>
            <h3 className="display-title mt-3 text-3xl text-[var(--color-primary)]">
              This instructor&apos;s first courses will appear here.
            </h3>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-[var(--color-ink-soft)]">
              {brand.name} only shows published courses from verified
              professionals on instructor storefronts. Browse the marketplace
              to see what is live now.
            </p>
            <Link href="/courses" className="button-solid mt-6 px-4 py-2.5 text-sm">
              Browse marketplace
            </Link>
          </div>
        ) : (
          <div className="marketplace-course-grid mt-6">
            {orderedCourses.map((course) => (
              <InstructorCourseCard
                key={course.id}
                course={course}
                instructor={{ name, photoURL: profile.photoURL }}
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function InstructorMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof BookOpen;
  label: string;
  value: string;
}) {
  return (
    <div className="instructor-storefront-metric">
      <span className="instructor-storefront-metric__icon">
        <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
      </span>
      <div>
        <p className="num text-2xl font-bold leading-none text-[var(--color-primary)]">
          {value}
        </p>
        <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--color-ink-soft)]">
          {label}
        </p>
      </div>
    </div>
  );
}

function InstructorCourseCard({
  course,
  instructor,
}: {
  course: TeacherCourse;
  instructor: { name: string; photoURL: string | null };
}) {
  return (
    <CourseTile
      href={`/courses/${course.id}`}
      title={course.title}
      image={course.coverImageUrl || "/brand/logo-mark.png"}
      summary={course.summary}
      category={course.category}
      meta={`${course.lessonCount} lesson${course.lessonCount === 1 ? "" : "s"}`}
      // O selo de status saiu: nesta vitrine todo curso listado ja e publico,
      // entao "Published" nao separava um cartao do outro.
      badge={course.freePreviewLessonId ? "Free preview" : null}
      priceLabel={formatPrice(course)}
      rating={
        course.ratingAverage && course.ratingCount
          ? { average: course.ratingAverage, count: course.ratingCount }
          : null
      }
      instructor={instructor}
      imageSizes="(max-width: 1024px) 100vw, 33vw"
    />
  );
}

function InstructorProfileSkeleton() {
  return (
    <section aria-busy="true" aria-live="polite">
      <p role="status" className="sr-only">
        Loading instructor profile...
      </p>
      <div className="rounded-[22px] border border-[var(--color-line)] bg-white p-8 shadow-[var(--shadow-soft)]">
        <div className="flex animate-pulse flex-col gap-5 sm:flex-row sm:items-center">
          <div className="size-20 rounded-full bg-[var(--color-surface-strong)]" />
          <div className="grid flex-1 gap-3">
            <div className="h-4 w-28 rounded bg-[var(--color-surface-strong)]" />
            <div className="h-10 w-3/4 rounded bg-[var(--color-surface-strong)]" />
            <div className="h-4 w-1/2 rounded bg-[var(--color-surface-strong)]" />
          </div>
        </div>
      </div>
    </section>
  );
}

function InstructorCourseSkeleton() {
  return (
    <div className="mt-6 grid gap-5 lg:grid-cols-3" aria-hidden="true">
      {[0, 1, 2].map((item) => (
        <div
          key={item}
          className="surface-card min-h-80 animate-pulse rounded-[18px]"
        />
      ))}
    </div>
  );
}

/**
 * Applies the teacher's showcase ordering: the featured course first, then the
 * explicit order from the storefront editor. Unranked courses keep their
 * incoming order at the end — same `?? MAX_SAFE_INTEGER` convention the
 * marketplace uses for a null `featured_rank`.
 */
function orderShowcaseCourses(
  courses: TeacherCourse[],
  showcase: StorefrontShowcase | null | undefined,
): TeacherCourse[] {
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

function getInstructorStats(courses: TeacherCourse[]) {
  const publicCourses = courses.filter((course) => !isInternalSmokeCourse(course));
  return {
    courseCount: publicCourses.length,
    lessonCount: publicCourses.reduce((total, course) => total + course.lessonCount, 0),
    categoryCount: new Set(publicCourses.map((course) => course.category)).size,
  };
}

function formatPrice(course: TeacherCourse): string {
  if (course.paymentType === "free") {
    return "Free enrollment";
  }

  if (typeof course.priceAmountMinor === "number") {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency: course.currency ?? "USD",
    }).format(course.priceAmountMinor / 100);
  }

  return "Enrollment opening soon";
}
