import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { CapabilitiesGrid } from "@/components/site/capabilities-grid";
import { FeaturedCourses } from "@/components/site/featured-courses";
import { ForCreatorsBand } from "@/components/site/for-creators-band";
import { HomeFactsBand } from "@/components/site/home-facts-band";
import { HomeFaq } from "@/components/site/home-faq";
import { HomeWhoFor } from "@/components/site/home-who-for";
import { HowItWorksStrip } from "@/components/site/how-it-works-strip";
import { MarketingHero } from "@/components/site/marketing-hero";
import { PromisePreviewBand } from "@/components/site/promise-preview-band";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteNav } from "@/components/site/site-nav";
import { getShowcaseCourseCover, isMarketplaceOpen } from "@/lib/data/server/public-course";
import { buildPageMetadata } from "@/lib/seo/page-metadata";
import { getServerTranslation } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getServerTranslation();
  return buildPageMetadata({
    title: t("home.metadata.title"),
    description: t("home.metadata.description"),
    path: "/",
  });
}

// The real course the home shows while the storefront is closed: the owner's.
// ponytail: fixed id; if that course goes offline, change it here (or read
// the most recently published course, if the swap becomes routine).
const SHOWCASE_COURSE_ID = "1a280dc6-acce-4f1f-9e95-56df095131ae";
const SHOWCASE_COURSE_PATH = `/courses/${SHOWCASE_COURSE_ID}`;

export default async function Home() {
  // Storefront closed (fewer than 12 courses from 5 teachers): the "The
  // marketplace" band gives way to a card that leads to ONE real course. The
  // menu is the same as on the other pages and hides "Courses" by the same
  // rule (layout).
  const marketplaceOpen = await isMarketplaceOpen();
  const { t } = await getServerTranslation();
  // The course's real cover, the same as on its own page: the home had almost
  // no imagery. Anonymous read cached for 5 min with a 1.5 s timeout (the same
  // as the storefront check). A read that fails or times out, a course that is
  // offline or has no cover: the usual text-only card, with no empty frame in
  // its place.
  const showcase = marketplaceOpen ? null : await getShowcaseCourseCover(SHOWCASE_COURSE_ID);
  const cover = showcase?.coverImageUrl ? { src: showcase.coverImageUrl, alt: showcase.title } : null;

  const courseCopy = (
    <span>
      <span className="block text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
        {t("home.realCourse.kicker")}
      </span>
      <span className="display-title mt-2 block text-2xl text-[var(--color-primary)] sm:text-3xl">
        {t("home.realCourse.title")}
      </span>
      <span className="mt-2 block max-w-2xl text-[1.0625rem] leading-[1.6] text-[var(--color-ink)] md:text-lg">
        {t("home.realCourse.body")}
      </span>
    </span>
  );
  const courseCta = (
    <span className="inline-flex shrink-0 items-center gap-2 text-sm font-semibold text-[var(--color-primary)]">
      {t("home.realCourse.cta")}
      <ArrowRight aria-hidden="true" size={16} strokeWidth={2} className="transition-transform group-hover:translate-x-0.5" />
    </span>
  );

  return (
    <div className="page-shell home-scroll">
      {/* .home-scroll turns on the scroll choreography (globals.css, "Home:
          scroll choreography"); the line below is the reading bar. */}
      <div aria-hidden="true" className="home-scroll-progress" />
      <SiteNav />
      {/* One <main> per page, the target of the bar's "Skip to content". */}
      <main id="conteudo">
        <MarketingHero />
        {/* Facts that are already true (currencies, flat fee, commitments and
            the trial), right below the top. No anchor: it is not a menu
            destination. */}
        <HomeFactsBand />
        <section id="how-it-works" className="home-how scroll-mt-28">
          <HowItWorksStrip />
        </section>
        {marketplaceOpen ? (
          <section id="courses" className="scroll-mt-28">
            <FeaturedCourses />
          </section>
        ) : (
          <section id="real-course" className="home-feature mx-auto w-full max-w-7xl px-5 sm:px-8">
            {cover ? (
              // Phone and tablet: cover on top (16:9, full width) and the text
              // below. The two columns only start at lg: between 768 and 1023
              // the text was much taller than the cover. From lg up the cover
              // sits on the left (45%), with its own margin and corners, and
              // cover and text are centered in height: the cover is always
              // 16:9, and never stretches or crops to follow the text. The
              // slow zoom on the mouse is the storefront photo's
              // (.marketplace-card__media img: 500ms, same curve, 1.045).
              <Link
                href={SHOWCASE_COURSE_PATH}
                className="group flex flex-col overflow-hidden rounded-lg border fine-rule bg-white shadow-[var(--shadow-soft)] transition hover:border-[var(--color-primary)] lg:flex-row lg:items-center"
              >
                <span className="relative block aspect-[16/9] overflow-hidden lg:m-6 lg:w-[45%] lg:shrink-0 lg:rounded-md">
                  <Image
                    src={cover.src}
                    alt={cover.alt}
                    fill
                    sizes="(min-width: 1280px) 548px, (min-width: 1024px) 45vw, 100vw"
                    className="object-cover transition-transform duration-500 ease-[cubic-bezier(0.2,0.6,0.2,1)] motion-safe:group-hover:scale-[1.045]"
                  />
                </span>
                <span className="flex flex-col justify-center gap-4 p-6 sm:p-8 lg:p-10 lg:pl-4">
                  {courseCopy}
                  {courseCta}
                </span>
              </Link>
            ) : (
              <Link
                href={SHOWCASE_COURSE_PATH}
                className="group flex flex-col gap-3 rounded-lg border fine-rule bg-white p-6 shadow-[var(--shadow-soft)] transition hover:border-[var(--color-primary)] sm:flex-row sm:items-center sm:justify-between sm:p-8"
              >
                {courseCopy}
                {courseCta}
              </Link>
            )}
          </section>
        )}
        <section id="capabilities" className="scroll-mt-28">
          <CapabilitiesGrid />
        </section>
        {/* Who it is for: the audience the site already names, with three
            portraits. No anchor, like the facts band: it is not a menu
            destination. */}
        <HomeWhoFor />
        <section id="promise" className="scroll-mt-28">
          <PromisePreviewBand />
        </section>
        {/* Frequently asked questions, with the answers from the help center. */}
        <section id="faq" className="scroll-mt-28">
          <HomeFaq />
        </section>
        <section id="for-creators" className="scroll-mt-28">
          <ForCreatorsBand />
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
