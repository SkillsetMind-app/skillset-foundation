"use client";

import { ArrowRight, BookOpen, GraduationCap, Star } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { UserAvatar } from "@/components/shared/user-avatar";
import { brand } from "@/data/brand";
import type { TeacherCourse } from "@/domain/teacher-course";
import type { PublicProfile } from "@/domain/user-profile";
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

  return (
    <>
      <section className="instructor-storefront-hero">
        <div className="instructor-storefront-hero__band">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
              Instructor storefront
            </p>
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
              label="Reviewed courses"
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
          <p className="mt-6 rounded-[10px] border border-[rgba(178,34,52,0.2)] bg-[rgba(178,34,52,0.06)] px-4 py-3 text-sm font-semibold text-[var(--color-accent-fg)]">
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
              {brand.name} only shows real reviewed courses on instructor
              storefronts. Browse the marketplace to see what is live now.
            </p>
            <Link href="/courses" className="button-solid mt-6 px-4 py-2.5 text-sm">
              Browse marketplace
            </Link>
          </div>
        ) : (
          <div className="marketplace-course-grid mt-6">
            {courses.map((course) => (
              <InstructorCourseCard key={course.id} course={course} />
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

function InstructorCourseCard({ course }: { course: TeacherCourse }) {
  const priceLabel = formatPrice(course);
  const lessonLabel = `${course.lessonCount} lesson${course.lessonCount === 1 ? "" : "s"}`;
  const image = course.coverImageUrl || "/brand/logo-mark.png";

  return (
    <article className="marketplace-card">
      <Link href={`/courses/${course.id}`} className="marketplace-card__media block">
        <Image
          src={image}
          alt={course.title}
          fill
          sizes="(max-width: 1024px) 100vw, 33vw"
          className="object-cover"
        />
        <div className="marketplace-card__scrim" />
        <div className="marketplace-card__badges">
          <span className="marketplace-card__tag">
            {course.status === "in_review" ? "Under review" : "Published"}
          </span>
        </div>
        <div className="marketplace-card__media-caption">
          <span>{lessonLabel}</span>
          <span>{priceLabel}</span>
        </div>
      </Link>
      <div className="marketplace-card__body">
        <span className="marketplace-card__kicker">{course.category}</span>
        <h3 className="marketplace-card__title">{course.title}</h3>
        <p className="marketplace-card__summary line-clamp-4">
          {course.summary}
        </p>
        <div className="marketplace-card__meta-panel">
          <p className="marketplace-card__price">{priceLabel}</p>
          <p className="marketplace-card__meta">
            {course.freePreviewLessonId ? "Free preview selected" : "Preview coming soon"}
          </p>
        </div>
        <Link
          href={`/courses/${course.id}`}
          className="button-solid mt-auto px-4 py-2.5 text-sm"
        >
          View course
        </Link>
      </div>
    </article>
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
