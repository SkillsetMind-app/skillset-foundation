"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { CourseTile, courseCardBadge } from "@/components/courses/course-tile";
import { useInstructorNames } from "@/components/courses/use-instructor-names";
import { useTranslation } from "@/components/i18n/i18n-provider";
import { RevealSection } from "@/components/shared/reveal-section";
import type { CourseCard } from "@/lib/data/catalog";
import { sortCourseCards } from "@/lib/data/course-sort";
import {
  isInternalSmokeCourse,
  subscribeToPublishedTeacherCourses,
  teacherCourseToCourseCard,
} from "@/lib/data/published-courses";
import { getSupabaseClientConfig } from "@/lib/supabase/config";

// A curated slice of the LIVE catalog, shown on the homepage so visitors see the
// real programs teachers have published. Same stream the /courses marketplace
// uses; ops-featured picks lead, capped at 6. While the catalog is empty the
// band keeps its heading and says so in one strip that invites teachers in,
// instead of four text cards dressed up as courses — an honest homepage beats
// a fabricated one, but silence is not honesty either.
const FEATURED_LIMIT = 6;

export function FeaturedCourses() {
  const { t } = useTranslation();
  const [featuredCourses, setFeaturedCourses] = useState<CourseCard[]>([]);
  const instructors = useInstructorNames(
    featuredCourses.map((course) => course.ownerId),
  );

  useEffect(() => {
    if (!getSupabaseClientConfig()) {
      return;
    }
    return subscribeToPublishedTeacherCourses(
      (nextCourses) => {
        setFeaturedCourses(
          sortCourseCards(
            nextCourses
              .filter((course) => !isInternalSmokeCourse(course))
              .map(teacherCourseToCourseCard),
            "featured",
          ).slice(0, FEATURED_LIMIT),
        );
      },
      // ponytail: the homepage band stays silent on error — /courses owns the
      // "couldn't load" message. A landing page must never show a red banner.
      () => {
        setFeaturedCourses([]);
      },
    );
  }, []);

  return (
    <section className="mx-auto w-full max-w-7xl px-5 py-16 sm:px-8 sm:py-20 lg:py-24">
      <RevealSection>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
              {t("home.marketplace.kicker")}
            </p>
            <h2 className="display-title mt-3 text-4xl leading-tight text-[var(--color-primary)] sm:text-5xl">
              {t("home.marketplace.title")}
            </h2>
            <p className="mt-4 text-[15px] leading-7 text-[var(--color-ink-soft)]">
              {t("home.marketplace.sub")}
            </p>
          </div>
          <Link
            href="/courses"
            className="group inline-flex w-fit items-center gap-2 whitespace-nowrap text-sm font-bold text-[var(--color-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
          >
            {t("home.marketplace.browseAll")}
            <ArrowRight
              aria-hidden="true"
              size={16}
              strokeWidth={2}
              className="transition-transform duration-200 group-hover:translate-x-1"
            />
          </Link>
        </div>

        {featuredCourses.length === 0 ? (
          <div className="mt-10 flex flex-col gap-4 rounded-[14px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)] sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[15px] font-semibold leading-7 text-[var(--color-ink)]">
              {t("home.marketplace.emptyTitle")}
            </p>
            <Link
              href="/for-creators"
              className="button-solid w-fit shrink-0 px-4 py-2.5 text-sm"
            >
              {t("home.marketplace.emptyCta")}
            </Link>
          </div>
        ) : (
        <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {featuredCourses.map((course) => (
            <li key={course.slug}>
              <CourseTile
                href={course.href ?? `/courses/${course.slug}`}
                title={course.title}
                image={course.image}
                summary={course.summary}
                category={course.category}
                meta={course.duration}
                badge={courseCardBadge(course)}
                priceLabel={course.priceLabel}
                rating={
                  course.ratingAverage && course.ratingCount
                    ? { average: course.ratingAverage, count: course.ratingCount }
                    : null
                }
                instructor={
                  (course.ownerId && instructors.get(course.ownerId)) || null
                }
                actionLabel={t("home.marketplace.viewCourse")}
              />
            </li>
          ))}
        </ul>
        )}
      </RevealSection>
    </section>
  );
}
