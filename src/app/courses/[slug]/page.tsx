import { getCourseCategoryLabel } from "@/lib/i18n/course-categories";
import { getServerTranslation } from "@/lib/i18n/server";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Target } from "lucide-react";

import { CourseDetailSkeleton } from "@/components/courses/course-detail-skeleton";
import { CourseEnrollmentCta } from "@/components/courses/course-enrollment-cta";
import { CourseModuleDisclosure } from "@/components/courses/course-module-disclosure";
import { CreatorCourseDetail } from "@/components/courses/creator-course-detail";
import { JsonLd } from "@/components/seo/json-ld";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteNav } from "@/components/site/site-nav";
import { formatTotalMinutes, isInternalSmokeCourse } from "@/domain/teacher-course";
import { getCourseBySlug, getCourseSlugs } from "@/lib/data/catalog";
import { getCourseRefAccess, getPublicCourseByRef, isMarketplaceOpen } from "@/lib/data/server/public-course";
import { buildCourseJsonLd } from "@/lib/seo/course-jsonld";
import { buildPageMetadata } from "@/lib/seo/page-metadata";

// Does not freeze the samples: the layout reads the header (nonce) and the page reads the
// language cookie, so the build marks the route as dynamic (ƒ) and each request
// decides on the spot whether the address is a real course or the sample.
export function generateStaticParams() {
  return getCourseSlugs().map((slug) => ({ slug }));
}

// The REAL course beats the sample. A course's address is the title_key (the title
// turned into a slug), so a course called "Effective Communication" lives at
// /courses/effective-communication, the same address as one of the six samples.
// The sample only shows up when no real course answers for it to whoever
// asks (published, or a draft the session can see); a read failure
// ("unknown") keeps the sample. The extra query only happens on the six sample slugs:
// the others already queried the database.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { t } = await getServerTranslation();
  const { slug } = await params;
  const published = await getPublicCourseByRef(slug);
  const sample = published ? undefined : getCourseBySlug(slug);
  const course = sample && (await getCourseRefAccess(slug)) !== "visible" ? sample : undefined;

  if (course) {
    // Demo sample: stays online (the owner's decision), but shows the price and
    // "Inscrever-se" of a course nobody buys — outside the index.
    return buildPageMetadata({
      title: course.title,
      description: course.summary,
      path: `/courses/${slug}`,
      image: course.image,
      noindex: true,
    });
  }

  // Creator course: resolved on the SERVER since anonymous reads came back
  // to work (migration 20260901120000). Before this, every real course fell into the
  // literal "Course" with the same description and the same logo — pasting the link of
  // any course into WhatsApp produced an identical card with no identity.
  if (published) {
    return buildPageMetadata({
      title: published.title,
      description:
        published.summary
        ?? t("publicCourses.courseMetaTitle").replace("{title}", () => published.title),
      path: `/courses/${published.urlSlug}`,
      image: published.coverImageUrl,
      // Internal test course opens by the link, but does not enter the index.
      noindex: isInternalSmokeCourse(published),
    });
  }

  // Draft, removed course or invalid slug: fallback scoped to the course, instead
  // of inheriting the site's generic title.
  return buildPageMetadata({
    title: t("publicCourses.course"),
    description:
      t("publicCourses.courseMeta"),
    path: `/courses/${slug}`,
  });
}

export default async function CourseDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { t, locale } = await getServerTranslation();
  const { slug } = await params;
  // Same order as generateMetadata: the real course first, the sample after.
  const published = await getPublicCourseByRef(slug);
  const access = published ? "visible" : await getCourseRefAccess(slug);
  const course = access === "visible" ? undefined : getCourseBySlug(slug);

  if (!course) {
    // An unpublished or removed course, or an invalid slug, answered 200 with an
    // empty page: bad for the quality of the ad page and for the
    // search engine. Here, BEFORE any Suspense, it becomes a real 404. The owner
    // (and the admin) keep seeing the draft: the read uses the request's session
    // and the RLS decides. A read failure ("unknown") does not become a 404: a database
    // hiccup must not take down the page of a published course.
    if (access === "missing") {
      notFound();
    }

    // Title and summary come from here, from the SERVER COMPONENT. Concrete reason:
    // CreatorCourseDetail calls useSearchParams(), so on a
    // prerendered route Next delivers only the Suspense FALLBACK in the HTML and throws
    // the whole subtree to the client. Passing the DATA as a prop to the
    // client component would not put a single word in the HTML. That is why
    // search engines and link scrapers saw "Loading course..." and the card came out empty.
    //
    // What goes as a prop is the ELEMENT already drawn here (`lead`), and it also goes
    // into the fallback: with or without the Suspense resolved on the server, the HTML
    // carries the h1, the cover and the summary. It becomes the top of the left column, and the
    // purchase card starts at the top of the page, next to the cover; before, the cover
    // came alone above the columns and pushed the price and button below the
    // first screen. On the phone the order stays: cover, title, summary, content,
    // card.
    const lead = published ? (
      <header id="overview" className="mb-8 scroll-mt-24">
        {/* The cover that the marketplace card already shows. Without a cover, nothing:
            art is not invented. */}
        {published.coverImageUrl ? (
          <div className="relative mb-8 aspect-[16/9] overflow-hidden rounded-lg shadow-[var(--shadow-soft)] lg:max-w-3xl">
            <Image
              src={published.coverImageUrl}
              alt={published.title}
              fill
              priority
              sizes="(min-width: 1024px) 60vw, 100vw"
              className="object-cover"
            />
          </div>
        ) : null}
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
          {published.category ? getCourseCategoryLabel(published.category, t) : t("publicCourses.course")}
        </p>
        <h1 className="display-title page-title mt-3 text-[var(--color-ink)]">
          {published.title}
        </h1>
        {published.summary ? (
          <p className="mt-4 max-w-2xl text-base leading-7 text-[var(--color-ink-soft)]">
            {published.summary}
          </p>
        ) : null}
        {published.lessonCount ? (
          <p className="mt-3 text-sm text-[var(--color-ink-muted)]">
            {t(published.lessonCount === 1 ? "publicCourses.lessonOne" : "publicCourses.lessonMany").replace("{count}", String(published.lessonCount))}
          </p>
        ) : null}
      </header>
    ) : null;

    return (
      <div className="page-shell">
        <SiteNav />
        <main id="conteudo" className="mx-auto w-full max-w-7xl px-5 py-10 sm:px-8 sm:py-14">
          {/* The same skeleton that the client shows while loading: from the server
              HTML until the course arrives, the page does not change shape. */}
          <Suspense fallback={<CourseDetailSkeleton label={t("publicCourses.loadingCourse")} lead={lead} />}>
            {/* hideHeader: the `lead` already has the title and summary; without this the
                client component drew a second h1 with the same text
                right below. */}
            <CreatorCourseDetail
              courseIdOverride={slug}
              hideHeader={Boolean(published)}
              lead={lead}
            />
          </Suspense>
        </main>
        {/* The page with a price is the one that most needs the footer: terms, refund
            policy and contact. Before, it ended at the curriculum. The pb-24
            keeps its end above the fixed purchase bar (on the phone, at the bottom
            of the screen; on desktop, the corner card when the column's one leaves). */}
        <div className="pb-24">
          <SiteFooter />
        </div>
      </div>
    );
  }

  const previewLessons = course.modules.flatMap((module) =>
    module.lessons
      .filter((lesson) => lesson.isPreview)
      .map((lesson) => ({ ...lesson, moduleTitle: module.title })),
  );

  // Static catalog courses are marketing SAMPLES with no row in the `courses`
  // table, so they can't be bought from this page — the CTA funnels to the live
  // marketplace (see <CourseEnrollmentCta>). Emit no purchasable Offer here, so
  // the JSON-LD can never claim InStock for a course this page cannot actually
  // sell (Article IV / Google structured-data parity).
  const purchasable = false;
  const priceLabel = course.priceAmountMinor == null ? t("publicCourses.priceAnnounced")
    : new Intl.NumberFormat(locale, { style: "currency", currency: course.currency }).format(course.priceAmountMinor / 100);
  const levelKeys = { Foundation: "foundation", Professional: "professional", Advanced: "advanced" };
  const hasRealCourses = await isMarketplaceOpen();

  return (
    <div className="page-shell">
      {/* Course/Offer structured data for organic discovery [C2]. Static catalog
          courses only — creator courses resolve client-side (see above). The
          Offer is emitted only when `purchasable`, matching the visible CTA. */}
      <JsonLd data={buildCourseJsonLd(course, { purchasable })} />
      <SiteNav />
      <main id="conteudo" className="mx-auto w-full max-w-7xl px-6 py-10 sm:px-8 sm:py-14">
        <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr]">
          <section id="overview" className="scroll-mt-24">
            <div className="relative mb-8 aspect-[16/9] overflow-hidden rounded-lg shadow-[var(--shadow-soft)]">
              <Image
                src={course.image}
                alt={course.title}
                fill
                priority
                sizes="(min-width: 1024px) 60vw, 100vw"
                className="object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[rgba(15,39,68,0.8)] via-transparent to-transparent" />
            </div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
              {getCourseCategoryLabel(course.category, t)}
            </p>
            {/* Title scales smoothly from 380px phones up to desktop — the
                fixed text-6xl used to overflow narrow viewports. */}
            <h1 className="display-title mt-4 text-[clamp(2rem,5vw,3.75rem)] leading-[1.05] text-[var(--color-primary)]">
              {course.title}
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-[var(--color-ink-soft)] sm:text-lg">
              {course.summary}
            </p>
            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              {course.outcomes.map((item) => (
                <div
                  key={item}
                  className="flex items-start gap-3 rounded-lg border fine-rule bg-white p-4"
                >
                  <span className="grid size-7 shrink-0 place-items-center rounded-md bg-[var(--color-surface-soft)] text-[var(--color-primary)]">
                    <Target aria-hidden="true" size={14} strokeWidth={2.2} />
                  </span>
                  <p className="text-sm font-semibold leading-6 text-[var(--color-ink)]">
                    {item}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-8 text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary-light)]">
              {course.detail}
            </p>
            {/* Section nav — anchors to the real, server-rendered sections so it
                stays SSR/SEO-safe and invents nothing. The design's Reviews and
                Instructor tabs are intentionally omitted: catalog courses carry
                no review or instructor-bio data, and fabricating it would
                violate No-Invention. */}
            <nav
              aria-label={t("publicCourses.sections")}
              className="mt-10 flex flex-wrap gap-1 border-b border-[var(--color-line)]"
            >
              {[
                [t("publicCourses.overview"), "#overview"],
                [t("publicCourses.preview"), "#free-preview"],
                [t("publicCourses.curriculum"), "#curriculum"],
              ].map(([label, href]) => (
                <Link
                  key={href}
                  href={href}
                  className="border-b-2 border-transparent px-4 py-3 text-sm font-semibold text-[var(--color-ink-soft)] transition hover:border-[var(--color-accent-fg)] hover:text-[var(--color-primary)]"
                >
                  {label}
                </Link>
              ))}
            </nav>
            {/* Free preview and curriculum used to live nested inside an
                outer white card with rounded-[16px] holding inner rounded-[14px]
                blocks — the rounded-on-rounded made the section feel busy.
                Now both sit as flat sibling sections with their own breathing
                room. */}
            <section
              id="free-preview"
              className="mt-10 scroll-mt-24 rounded-lg border fine-rule bg-[var(--color-surface-soft)] p-5 sm:p-6"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">{t("publicCourses.preview")}</p>
              <h2 className="display-title mt-3 text-3xl text-[var(--color-ink)]">
                {t("publicCourses.previewInside")}
              </h2>
              <div className="mt-4 grid gap-3">
                {previewLessons.length > 0 ? (
                  previewLessons.map((lesson) => (
                    <div
                      key={lesson.id}
                      className="flex items-center justify-between gap-3 rounded-md bg-white px-4 py-3 text-sm"
                    >
                      <div>
                        <p className="font-semibold text-[var(--color-ink)]">
                          {lesson.title}
                        </p>
                        <p className="mt-1 text-xs text-[var(--color-ink-soft)]">
                          {lesson.moduleTitle}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-md bg-[var(--color-surface-soft)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-primary)]">
                        {lesson.duration}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-sm leading-7 text-[var(--color-ink-soft)]">
                    {t("publicCourses.noPreview")}
                  </p>
                )}
              </div>
            </section>

            <section id="curriculum" className="mt-8 scroll-mt-24">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">{t("publicCourses.structure")}</p>
              {/* The same curriculum as the page of a real course: one module
                  per accordion (the first one open), lessons and duration on the
                  module row, 44px rows and data in normal case with " · ". */}
              <div className="mt-5 grid gap-3">
                {course.modules.map((module, moduleIndex) => (
                  <CourseModuleDisclosure
                    key={module.id}
                    title={module.title}
                    meta={[
                      t(module.lessons.length === 1 ? "publicCourses.lessonOne" : "publicCourses.lessonMany")
                        .replace("{count}", String(module.lessons.length)),
                      // The sample stores the duration as text ("12 min").
                      formatTotalMinutes(module.lessons.map((lesson) => Number(/^(\d+) min$/.exec(lesson.duration)?.[1]))),
                    ].filter(Boolean).join(" · ")}
                    defaultOpen={moduleIndex === 0}
                    headingLevel={3}
                  >
                    <p className="px-4 pb-3 text-sm leading-6 text-[var(--color-ink-soft)]">
                      {module.summary}
                    </p>
                    <div className="grid gap-2 px-3 pb-3">
                      {module.lessons.map((lesson) => (
                        <div
                          key={lesson.id}
                          className="flex min-h-11 items-center justify-between gap-3 rounded-md bg-white px-3 py-2.5 text-sm text-[var(--color-ink-soft)]"
                        >
                          <span className="font-semibold text-[var(--color-ink)]">
                            {lesson.title}
                          </span>
                          <span className="shrink-0 text-right text-xs">
                            {[
                              t(`publicCourses.lessonTypes.${lesson.type}`),
                              lesson.duration,
                              t(lesson.isPreview ? "publicCourses.previewShort" : "publicCourses.locked"),
                            ].filter(Boolean).join(" · ")}
                          </span>
                        </div>
                      ))}
                    </div>
                  </CourseModuleDisclosure>
                ))}
              </div>
            </section>
          </section>
          <aside id="enroll-card" className="h-fit scroll-mt-24 self-start rounded-lg border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)] lg:sticky lg:top-24">
            {/* Price hero: the priceLabel used to be a single line in a
                six-row <dl> alongside Category and Level — buyers had to
                scan past four neutral rows to find what it costs. Now it
                anchors the sidebar so the cost is the first thing you see. */}
            {/* "Price" in 12px, as on the real course card: "Access" in 10px
                did not say that the number below is the price. */}
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[var(--color-accent-fg)]">{t("publicCourses.priceEyebrow")}</p>
            <p className="display-title mt-1 text-4xl leading-none text-[var(--color-primary)]">
              {priceLabel}
            </p>
            <p className="mt-2 text-xs leading-5 text-[var(--color-ink-soft)]">
              {t(`publicCourses.demoMetadata.${course.id}.preview`)}
            </p>

            <div className="mt-5 h-px bg-[var(--color-line)]" />

            <dl className="mt-5 grid gap-4">
              {[
                [t("publicCourses.duration"), t(`publicCourses.demoMetadata.${course.id}.duration`)],
                [t("publicCourses.status"), t(`publicCourses.demoMetadata.${course.id}.status`)],
                [t("publicCourses.category"), getCourseCategoryLabel(course.category, t)],
                [t("publicCourses.level"), t(`publicCourses.${levelKeys[course.level]}`)],
              ].map(([label, value]) => (
                <div key={label} className="border-b border-[var(--color-line)] pb-4 last:border-b-0 last:pb-0">
                  <dt className="text-xs uppercase tracking-[0.18em] text-[var(--color-ink-soft)]">
                    {label}
                  </dt>
                  <dd className="mt-1 text-sm font-semibold text-[var(--color-ink)]">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            <CourseEnrollmentCta course={course} />
            <Link href="#free-preview" className="button-outline mt-3 w-full px-4 py-2.5 text-sm">{t("publicCourses.seePreview")}</Link>
            {/* An empty store is not a destination: the back link leads to the start. */}
            <Link
              href={hasRealCourses ? "/courses" : "/"}
              className="mt-4 inline-flex w-full justify-center text-sm font-semibold text-[var(--color-primary)]"
            >{t(hasRealCourses ? "publicCourses.backCourses" : "publicPages.notFound.home")}</Link>
          </aside>
        </div>
      </main>
      {/* pb-24: the footer ends above the phone's fixed enrollment bar. */}
      <div className="pb-24 lg:pb-0">
        <SiteFooter />
      </div>

      {/* Mobile sticky enroll bar: on phones the aside lives at the bottom
          of the grid (single column), so a buyer has to scroll past every
          module to find the CTA. This sticky bar surfaces the price and
          scrolls them straight to the enroll card. Hidden on lg+ where
          the aside is already sticky in the side column. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 pb-3 lg:hidden">
        <div className="pointer-events-auto flex items-center gap-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)]/95 px-4 py-3 shadow-[0_-6px_30px_rgba(15,39,68,0.18)] backdrop-blur supports-[backdrop-filter]:bg-[var(--color-surface)]/85">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">{t("publicCourses.priceEyebrow")}</p>
            <p className="display-title truncate text-xl leading-none text-[var(--color-primary)]">
              {priceLabel}
            </p>
          </div>
          <Link
            href="#enroll-card"
            className="button-solid shrink-0 px-3.5 py-2 text-xs"
          >{t("publicCourses.enroll")}</Link>
        </div>
      </div>
    </div>
  );
}
