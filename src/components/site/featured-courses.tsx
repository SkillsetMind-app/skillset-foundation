"use client";

import { ArrowRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { RevealSection } from "@/components/shared/reveal-section";
import { demoCourses } from "@/data/demo/courses";

// A curated slice of the catalog, shown on the homepage so visitors see real,
// reviewed programs (with cover art) instead of marketing copy alone. Uses the
// static demo catalog so the band always renders for the landing page; the
// full, live marketplace lives at /courses.
const featuredCourses = demoCourses.slice(0, 6);

export function FeaturedCourses() {
  const { t } = useTranslation();
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
            className="group inline-flex w-fit items-center gap-2 whitespace-nowrap text-sm font-bold text-[var(--color-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgba(44,82,130,0.35)]"
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

        <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {featuredCourses.map((course) => (
            <li key={course.id}>
              <Link
                href={`/courses/${course.slug}`}
                className="marketplace-card group focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgba(44,82,130,0.35)]"
              >
                <div className="marketplace-card__media">
                  <Image
                    src={course.image}
                    alt={course.title}
                    fill
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                    className="object-cover"
                  />
                  <div className="marketplace-card__scrim" />
                  <div className="marketplace-card__badges">
                    <span className="marketplace-card__tag">
                      {course.statusLabel}
                    </span>
                  </div>
                  <div className="marketplace-card__media-caption">
                    <span>{course.level}</span>
                    <span>{course.priceLabel}</span>
                  </div>
                </div>
                <div className="marketplace-card__body">
                  <p className="marketplace-card__kicker">
                    {course.category} · {course.level}
                  </p>
                  <h3 className="marketplace-card__title">
                    {course.title}
                  </h3>
                  <p className="marketplace-card__summary line-clamp-2">
                    {course.summary}
                  </p>
                  <div className="marketplace-card__actions items-center justify-between">
                    <span className="marketplace-card__price">
                      {course.priceLabel}
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-[var(--color-primary)]">
                      {t("home.marketplace.viewCourse")}
                      <ArrowRight
                        aria-hidden="true"
                        size={14}
                        strokeWidth={2}
                        className="transition-transform duration-200 group-hover:translate-x-1"
                      />
                    </span>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </RevealSection>
    </section>
  );
}
