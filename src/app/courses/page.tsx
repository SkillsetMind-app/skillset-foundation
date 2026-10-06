import { getServerTranslation } from "@/lib/i18n/server";
import Link from "next/link";
import { Suspense } from "react";

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
  // Loja vazia fora do índice, mas os links dela seguem valendo. Volta a ser
  // indexável sozinha quando o primeiro curso real é publicado.
  return hasRealCourses ? metadata : { ...metadata, robots: { index: false, follow: true } };
}

export default async function CoursesPage() {
  const [{ t }, hasRealCourses] = await Promise.all([getServerTranslation(), hasRealPublishedCourse()]);

  // Sem curso real publicado, nada de vitrine com filtro, busca e esqueleto de
  // cartões: a página diz o que é verdade e aponta para quem vai publicar.
  if (!hasRealCourses) {
    return (
      <div className="page-shell">
        <SiteNav />
        <main id="conteudo" className="mx-auto w-full max-w-7xl px-6 py-10 sm:px-8 sm:py-14">
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
      <main id="conteudo" className="mx-auto w-full max-w-7xl px-6 py-10 sm:px-8 sm:py-14">
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
              className="h-9 animate-pulse rounded-md bg-[var(--color-surface-strong)]"
              style={{ width }}
            />
          ))}
        </div>
        <div className="grid gap-3">
          <div className="grid gap-2">
            <div className="h-3 w-12 animate-pulse rounded bg-[var(--color-surface-strong)]" />
            <div className="h-11 animate-pulse rounded-md bg-[var(--color-surface-soft)]" />
          </div>
          <div className="grid gap-2">
            <div className="h-3 w-10 animate-pulse rounded bg-[var(--color-surface-strong)]" />
            <div className="h-11 animate-pulse rounded-md bg-[var(--color-surface-soft)]" />
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
