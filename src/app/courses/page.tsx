import { getServerTranslation } from "@/lib/i18n/server";
import { Suspense } from "react";

import { CourseMarketplace } from "@/components/courses/course-marketplace";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteNav } from "@/components/site/site-nav";
import { buildPageMetadata } from "@/lib/seo/page-metadata";

export async function generateMetadata() {
  const { t } = await getServerTranslation();
  return buildPageMetadata({
  title: t("publicCourses.browseTitle"),
  description:
    t("publicCourses.browseDescription"),
  path: "/courses",
  });
}

export default async function CoursesPage() {
  const { t } = await getServerTranslation();
  return (
    <div className="page-shell">
      <SiteNav />
      <main className="mx-auto w-full max-w-7xl px-6 py-10 sm:px-8 sm:py-14">
        <div className="marketplace-page-header mb-8">
          <div className="marketplace-page-header__grid">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">{t("publicCourses.marketplace")}</p>
              <h1 className="display-title marketplace-page-title">{t("publicCourses.findCourse")}</h1>
            </div>
            <p className="marketplace-page-copy">{t("publicCourses.browseBody")}</p>
          </div>
        </div>

        <Suspense fallback={<MarketplaceSkeleton />}>
          <CourseMarketplace />
        </Suspense>
      </main>
      <SiteFooter />
    </div>
  );
}

// SSR-visible fallback that mirrors the client-side loading state in
// CourseMarketplace. Without this, search engines and no-JS visitors see
// t("publicCourses.loadingCourses") and bounce — the real page has filters + a card grid.
function MarketplaceSkeleton() {
  return (
    <section aria-hidden="true">
      <div className="mb-8 grid gap-3 lg:grid-cols-[1fr_280px] lg:items-start">
        <div className="flex flex-wrap gap-2.5">
          {[80, 110, 96, 88, 120].map((width, index) => (
            <div
              key={index}
              className="h-9 animate-pulse rounded-[10px] bg-[var(--color-surface-strong)]"
              style={{ width }}
            />
          ))}
        </div>
        <div className="grid gap-3">
          <div className="grid gap-2">
            <div className="h-3 w-12 animate-pulse rounded bg-[var(--color-surface-strong)]" />
            <div className="h-11 animate-pulse rounded-[10px] bg-[var(--color-surface-soft)]" />
          </div>
          <div className="grid gap-2">
            <div className="h-3 w-10 animate-pulse rounded bg-[var(--color-surface-strong)]" />
            <div className="h-11 animate-pulse rounded-[10px] bg-[var(--color-surface-soft)]" />
          </div>
        </div>
      </div>
      <div className="marketplace-course-grid">
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <div
            key={index}
            className="marketplace-card animate-pulse"
          >
            <div className="marketplace-card__media bg-[var(--color-surface-strong)]" />
            <div className="space-y-3 p-5">
              <div className="h-3 w-24 rounded bg-[var(--color-surface-strong)]" />
              <div className="h-6 w-3/4 rounded bg-[var(--color-surface-strong)]" />
              <div className="h-16 rounded bg-[var(--color-surface-soft)]" />
              <div className="h-8 w-1/3 rounded bg-[var(--color-surface-soft)]" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
