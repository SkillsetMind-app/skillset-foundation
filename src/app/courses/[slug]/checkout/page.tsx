import { getServerTranslation } from "@/lib/i18n/server";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";

import { CreatorCourseDetail } from "@/components/courses/creator-course-detail";
import { CheckoutHeader } from "@/components/site/checkout-header";
import { getPublicCourseByRef } from "@/lib/data/server/public-course";
import { buildPageMetadata } from "@/lib/seo/page-metadata";

type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { t } = await getServerTranslation();
  const { slug } = await params;
  const course = await getPublicCourseByRef(slug);
  return buildPageMetadata({
    title: course ? t("publicCourses.checkoutCourseTitle").replace("{title}", () => course.title) : t("publicCourses.checkoutTitle"),
    description: course?.summary || t("publicCourses.checkoutDescription"),
    path: `/courses/${encodeURIComponent(slug)}/checkout`,
    image: course?.coverImageUrl,
  });
}

// The purchase step. The order summary (cover, title, what the course has)
// is server HTML; the payment card, which depends on the session, the price
// and the offer, mounts on the side. On a phone the summary comes first and
// stays short, so the form starts within the first screen.
export default async function CourseCheckoutPage({ params }: PageProps) {
  const { t } = await getServerTranslation();
  const { slug } = await params;
  const course = await getPublicCourseByRef(slug);
  // Comunidade, e-book e evento ao vivo não são aulas: o número só vale para curso.
  const lessonCount = (course?.productFormat ?? "course") === "course" ? course?.lessonCount ?? 0 : 0;
  return (
    <div className="page-shell">
      <CheckoutHeader secureLabel={t("publicCourses.checkoutSecure")} skipLabel={t("nav.skipToContent")} />
      {/* No celular cada pixel conta para o botão de comprar caber na
          primeira tela (375×812): margens menores e o resumo sem o link. */}
      <main id="conteudo" className="mx-auto w-full max-w-5xl px-4 py-4 sm:px-8 sm:py-10">
        <div className="grid gap-4 sm:gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-10">
          {course ? (
            <aside
              data-checkout-summary
              className="min-w-0 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-soft)] sm:p-5 lg:sticky lg:top-6 lg:order-2"
            >
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
                {t("publicCourses.checkoutYourOrder")}
              </p>
              <div className="mt-3 flex items-start gap-4 lg:block">
                {/* Sem capa, nada: não se inventa arte. */}
                {course.coverImageUrl ? (
                  <div className="relative aspect-[16/9] w-28 shrink-0 overflow-hidden rounded-md sm:w-36 lg:w-full">
                    <Image
                      src={course.coverImageUrl}
                      alt=""
                      fill
                      priority
                      sizes="(min-width: 1024px) 22rem, 9rem"
                      className="object-cover"
                    />
                  </div>
                ) : null}
                <div className="min-w-0 lg:mt-4">
                  <h1 className="display-title break-words text-xl leading-tight text-[var(--color-ink)] sm:text-2xl">
                    {course.title}
                  </h1>
                  {lessonCount > 0 ? (
                    <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
                      {t(lessonCount === 1 ? "publicCourses.lessonOne" : "publicCourses.lessonMany").replace("{count}", String(lessonCount))}
                    </p>
                  ) : null}
                </div>
              </div>
              {course.summary ? (
                <p className="mt-4 hidden text-sm leading-6 text-[var(--color-ink-soft)] lg:line-clamp-5">
                  {course.summary}
                </p>
              ) : null}
              <Link
                href={`/courses/${encodeURIComponent(course.urlSlug)}`}
                className="mt-3 hidden min-h-11 items-center text-sm font-semibold text-[var(--color-primary)] underline-offset-4 hover:underline lg:inline-flex"
              >
                {t("publicCourses.checkoutCourseDetails")}
              </Link>
            </aside>
          ) : null}
          <div className="min-w-0 lg:order-1">
            <Suspense fallback={<p role="status">{t("publicCourses.loadingCheckout")}</p>}>
              <CreatorCourseDetail courseIdOverride={slug} checkoutOnly hideHeader={Boolean(course)} />
            </Suspense>
          </div>
        </div>
      </main>
    </div>
  );
}
