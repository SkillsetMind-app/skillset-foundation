import { getServerTranslation } from "@/lib/i18n/server";
import Link from "next/link";
import { Suspense } from "react";

import { CourseGridSkeleton } from "@/components/courses/course-grid-skeleton";
import { CourseMarketplace } from "@/components/courses/course-marketplace";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteNav } from "@/components/site/site-nav";
import { hasRealPublishedCourse } from "@/lib/data/server/public-course";
import { buildPageMetadata } from "@/lib/seo/page-metadata";

export async function generateMetadata() {
  const [{ t }, hasRealCourses] = await Promise.all([getServerTranslation(), hasRealPublishedCourse()]);
  const metadata = buildPageMetadata({
  title: t("publicCourses.browseTitle"),
  description:
    t("publicCourses.browseDescription"),
  path: "/courses",
  });
  // Empty store outside the index, but its links stay valid. It becomes
  // indexable on its own when the first real course is published.
  return hasRealCourses ? metadata : { ...metadata, robots: { index: false, follow: true } };
}

export default async function CoursesPage() {
  const [{ t }, hasRealCourses] = await Promise.all([getServerTranslation(), hasRealPublishedCourse()]);

  // Without a published real course, no storefront with filter, search and card
  // skeleton: the page says what is true and points to who is going to publish.
  if (!hasRealCourses) {
    return (
      <div className="page-shell">
        <SiteNav />
        <main id="conteudo" className="mx-auto w-full max-w-7xl px-5 py-10 sm:px-8 sm:py-14">
          <section className="marketplace-empty">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">{t("publicCourses.openingSoon")}</p>
            <h1 className="display-title mt-3 text-3xl text-[var(--color-ink)] sm:text-4xl">{t("publicCourses.firstCourses")}</h1>
            <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-[var(--color-ink-soft)]">{t("publicCourses.openingBody")}</p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link href="/auth?mode=signup&path=teacher" className="button-solid px-4 py-2.5 text-sm">{t("publicCourses.startTeaching")}</Link>
              <Link href="/for-creators" className="button-outline px-4 py-2.5 text-sm">{t("publicCourses.creatorOverview")}</Link>
            </div>
          </section>
        </main>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="page-shell">
      <SiteNav />
      <main id="conteudo" className="mx-auto w-full max-w-7xl px-5 py-10 sm:px-8 sm:py-14">
        <div className="marketplace-page-header mb-8">
          <div className="marketplace-page-header__grid">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">{t("publicCourses.marketplace")}</p>
              <h1 className="display-title marketplace-page-title">{t("publicCourses.findCourse")}</h1>
            </div>
            <p className="marketplace-page-copy">{t("publicCourses.browseBody")}</p>
          </div>
        </div>

        <Suspense fallback={<MarketplaceSkeleton label={t("publicCourses.loadingCourses")} />}>
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
// Draws the real filter panel (row of categories over the search
// and sort line), and not the side column the store does not have, and the same
// cards as the client loading: nothing changes place between the two.
function MarketplaceSkeleton({ label }: { label: string }) {
  return (
    <section className="marketplace-section">
      <p role="status" className="sr-only">{label}</p>
      <div className="marketplace-filter-panel" aria-hidden="true">
        {/* On the phone the real panel opens closed, behind the "Filters" button:
            the wait draws the same button, so nothing jumps when it arrives. */}
        <div className="marketplace-filters-toggle">
          <div className="h-4 w-20 animate-pulse rounded bg-[var(--color-surface-strong)]" />
        </div>
        <div className="marketplace-filter-body">
          <div className="marketplace-filter-list">
            {[110, 120, 96, 104].map((width, index) => (
              <div
                key={index}
                className="h-11 animate-pulse rounded-md bg-[var(--color-surface-strong)]"
                style={{ width }}
              />
            ))}
          </div>
          <div className="marketplace-controls">
            {[0, 1].map((index) => (
              <div key={index} className="grid gap-2">
                <div className="h-3 w-12 animate-pulse rounded bg-[var(--color-surface-strong)]" />
                <div className="h-11 animate-pulse rounded-md bg-[var(--color-surface-strong)]" />
              </div>
            ))}
          </div>
        </div>
      </div>
      <CourseGridSkeleton />
    </section>
  );
}
