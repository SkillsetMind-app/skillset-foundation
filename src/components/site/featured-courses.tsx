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
                className="group flex h-full flex-col overflow-hidden rounded-[14px] border fine-rule bg-white shadow-[var(--shadow-soft)] transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_22px_44px_rgba(15,39,68,0.12)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgba(44,82,130,0.35)]"
              >
                <div className="relative aspect-[16/10] overflow-hidden bg-[var(--color-surface-soft)]">
                  <Image
                    src={course.image}
                    alt={course.title}
                    fill
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                    className="object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                  />
                  <span className="absolute left-3 top-3 rounded-[8px] bg-white/90 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-primary)] backdrop-blur-sm">
                    {course.statusLabel}
                  </span>
                </div>
                <div className="flex flex-1 flex-col p-5">
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--color-accent-fg)]">
                    {course.category} · {course.level}
                  </p>
                  <h3 className="display-title mt-2 text-xl leading-snug text-[var(--color-primary)]">
                    {course.title}
                  </h3>
                  <p className="mt-2 line-clamp-2 text-sm leading-6 text-[var(--color-ink-soft)]">
                    {course.summary}
                  </p>
                  <div className="mt-4 flex items-center justify-between gap-2 border-t border-[var(--color-line)] pt-3">
                    <span className="text-sm font-bold text-[var(--color-ink)]">
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
