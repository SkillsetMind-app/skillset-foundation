import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { Target } from "lucide-react";

import { CourseEnrollmentCta } from "@/components/courses/course-enrollment-cta";
import { CreatorCourseDetail } from "@/components/courses/creator-course-detail";
import { JsonLd } from "@/components/seo/json-ld";
import { SiteNav } from "@/components/site/site-nav";
import { getCourseBySlug, getCourseSlugs } from "@/lib/data/catalog";
import { buildCourseJsonLd } from "@/lib/seo/course-jsonld";
import { buildPageMetadata } from "@/lib/seo/page-metadata";

export function generateStaticParams() {
  return getCourseSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const course = getCourseBySlug(slug);

  if (course) {
    return buildPageMetadata({
      title: course.title,
      description: course.summary,
      path: `/courses/${slug}`,
    });
  }

  // Creator (Firestore) courses resolve client-side, so their title is not
  // available at build/SSR without the Admin SDK. Give a clean course-scoped
  // fallback instead of inheriting the generic site-wide title.
  return buildPageMetadata({
    title: "Course",
    description:
      "Explore this SkillsetMind course — curriculum, preview lessons, and enrollment.",
    path: `/courses/${slug}`,
  });
}

export default async function CourseDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const course = getCourseBySlug(slug);

  if (!course) {
    return (
      <div className="page-shell">
        <SiteNav />
        <main className="mx-auto w-full max-w-7xl px-6 py-10 sm:px-8 sm:py-14">
          <Suspense
            fallback={
              <section className="rounded-[18px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)]">
                <p className="text-sm text-[var(--color-ink-soft)]">
                  Loading creator course...
                </p>
              </section>
            }
          >
            <CreatorCourseDetail courseIdOverride={slug} />
          </Suspense>
        </main>
      </div>
    );
  }

  const previewLessons = course.modules.flatMap((module) =>
    module.lessons
      .filter((lesson) => lesson.isPreview)
      .map((lesson) => ({ ...lesson, moduleTitle: module.title })),
  );

  // Static catalog courses are marketing SAMPLES, not Firestore-backed records,
  // so they can't be bought from this page — the CTA funnels to the live
  // marketplace (see <CourseEnrollmentCta>). Emit no purchasable Offer here, so
  // the JSON-LD can never claim InStock for a course this page cannot actually
  // sell (Article IV / Google structured-data parity).
  const purchasable = false;

  return (
    <div className="page-shell">
      {/* Course/Offer structured data for organic discovery [C2]. Static catalog
          courses only — creator courses resolve client-side (see above). The
          Offer is emitted only when `purchasable`, matching the visible CTA. */}
      <JsonLd data={buildCourseJsonLd(course, { purchasable })} />
      <SiteNav />
      <main className="mx-auto w-full max-w-7xl px-6 py-10 sm:px-8 sm:py-14">
        <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr]">
          <section id="overview" className="scroll-mt-24">
            <div className="relative mb-8 aspect-[16/9] overflow-hidden rounded-[20px] shadow-[var(--shadow-soft)]">
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
              {course.category}
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
                  className="flex items-start gap-3 rounded-[14px] border fine-rule bg-white p-4"
                >
                  <span className="grid size-7 shrink-0 place-items-center rounded-[8px] bg-[var(--color-surface-soft)] text-[var(--color-primary)]">
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
              aria-label="Course sections"
              className="mt-10 flex flex-wrap gap-1 border-b border-[var(--color-line)]"
            >
              {[
                ["Overview", "#overview"],
                ["Free preview", "#free-preview"],
                ["Curriculum", "#curriculum"],
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
              className="mt-10 scroll-mt-24 rounded-[14px] border fine-rule bg-[var(--color-surface-soft)] p-5 sm:p-6"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
                Free preview
              </p>
              <h2 className="display-title mt-3 text-3xl text-[var(--color-ink)]">
                Preview what&apos;s inside.
              </h2>
              <div className="mt-4 grid gap-3">
                {previewLessons.length > 0 ? (
                  previewLessons.map((lesson) => (
                    <div
                      key={lesson.id}
                      className="flex items-center justify-between gap-3 rounded-[10px] bg-white px-4 py-3 text-sm"
                    >
                      <div>
                        <p className="font-semibold text-[var(--color-ink)]">
                          {lesson.title}
                        </p>
                        <p className="mt-1 text-xs text-[var(--color-ink-soft)]">
                          {lesson.moduleTitle}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-[8px] bg-[var(--color-surface-soft)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--color-primary)]">
                        {lesson.duration}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-sm leading-7 text-[var(--color-ink-soft)]">
                    The instructor has not added a public preview lesson yet.
                  </p>
                )}
              </div>
            </section>

            <section id="curriculum" className="mt-8 scroll-mt-24">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
                Course structure
              </p>
              <div className="mt-5 grid gap-4">
                {course.modules.map((module) => (
                  <div key={module.id} className="rounded-[12px] border fine-rule bg-[var(--color-surface-soft)] p-4">
                    <h3 className="text-sm font-semibold text-[var(--color-ink)]">
                      {module.title}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-[var(--color-ink-soft)]">
                      {module.summary}
                    </p>
                    <div className="mt-4 grid gap-2">
                      {module.lessons.map((lesson) => (
                        <div
                          key={lesson.id}
                          className="flex items-center justify-between gap-3 rounded-[10px] bg-white px-3 py-2 text-xs text-[var(--color-ink-soft)]"
                        >
                          <span className="font-semibold text-[var(--color-ink)]">
                            {lesson.title}
                          </span>
                          <span className="shrink-0 uppercase tracking-[0.16em]">
                            {lesson.isPreview ? "Preview" : "Locked"} -{" "}
                            {lesson.type.replace("_", " ")} - {lesson.duration}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </section>
          <aside id="enroll-card" className="h-fit scroll-mt-24 self-start rounded-[18px] border border-[var(--color-line)] bg-white p-6 shadow-[var(--shadow-soft)] lg:sticky lg:top-24">
            {/* Price hero: the priceLabel used to be a single line in a
                six-row <dl> alongside Category and Level — buyers had to
                scan past four neutral rows to find what it costs. Now it
                anchors the sidebar so the cost is the first thing you see. */}
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
              Access
            </p>
            <p className="display-title mt-1 text-4xl leading-none text-[var(--color-primary)]">
              {course.priceLabel}
            </p>
            <p className="mt-2 text-xs leading-5 text-[var(--color-ink-soft)]">
              {course.freePreviewLabel}
            </p>

            <div className="mt-5 h-px bg-[var(--color-line)]" />

            <dl className="mt-5 grid gap-4">
              {[
                ["Duration", course.durationLabel],
                ["Status", course.statusLabel],
                ["Category", course.category],
                ["Level", course.level],
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
            <Link href="#free-preview" className="button-outline mt-3 w-full px-4 py-2.5 text-sm">
              See free preview lessons
            </Link>
            <Link
              href="/courses"
              className="mt-4 inline-flex w-full justify-center text-sm font-semibold text-[var(--color-primary)]"
            >
              Back to all courses
            </Link>
          </aside>
        </div>
      </main>

      {/* Mobile sticky enroll bar: on phones the aside lives at the bottom
          of the grid (single column), so a buyer has to scroll past every
          module to find the CTA. This sticky bar surfaces the price and
          scrolls them straight to the enroll card. Hidden on lg+ where
          the aside is already sticky in the side column. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 pb-3 lg:hidden">
        <div className="pointer-events-auto flex items-center gap-3 rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface)]/95 px-4 py-3 shadow-[0_-6px_30px_rgba(15,39,68,0.18)] backdrop-blur supports-[backdrop-filter]:bg-[var(--color-surface)]/85">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-accent-fg)]">
              Access
            </p>
            <p className="display-title truncate text-xl leading-none text-[var(--color-primary)]">
              {course.priceLabel}
            </p>
          </div>
          <Link
            href="#enroll-card"
            className="button-solid shrink-0 px-3.5 py-2 text-xs"
          >
            Enroll
          </Link>
        </div>
      </div>
    </div>
  );
}
