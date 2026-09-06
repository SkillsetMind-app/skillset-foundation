import { getServerTranslation } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { Suspense } from "react";

import { CreatorCourseDetail } from "@/components/courses/creator-course-detail";
import { SiteNav } from "@/components/site/site-nav";
import { getPublicCourseByRef } from "@/lib/data/server/public-course";
import { buildPageMetadata } from "@/lib/seo/page-metadata";

type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { t } = await getServerTranslation();
  const { slug } = await params;
  const course = await getPublicCourseByRef(slug);
  return buildPageMetadata({
    title: course ? t("publicCourses.checkoutCourseTitle").replace("{title}", course.title) : t("publicCourses.checkoutTitle"),
    description: course?.summary || t("publicCourses.checkoutDescription"),
    path: `/courses/${encodeURIComponent(slug)}/checkout`,
    image: course?.coverImageUrl,
  });
}

export default async function CourseCheckoutPage({ params }: PageProps) {
  const { t } = await getServerTranslation();
  const { slug } = await params;
  const course = await getPublicCourseByRef(slug);
  return (
    <div className="page-shell">
      <SiteNav />
      <main className="mx-auto w-full max-w-2xl px-6 py-10 sm:px-8 sm:py-14">
        {course ? (
          <header className="mb-6">
            <h1 className="display-title page-title break-words text-[var(--color-ink)]">{course.title}</h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-[var(--color-ink-soft)]">{course.summary}</p>
          </header>
        ) : null}
        <Suspense fallback={<p role="status">{t("publicCourses.loadingCheckout")}</p>}>
          <CreatorCourseDetail courseIdOverride={slug} checkoutOnly hideHeader={Boolean(course)} />
        </Suspense>
      </main>
    </div>
  );
}
