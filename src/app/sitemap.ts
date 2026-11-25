import type { MetadataRoute } from "next";

import { hasRealPublishedCourse, listPublishedCourses } from "@/lib/data/server/public-course";
import { SITE_URL } from "@/lib/seo/page-metadata";

// It was `force-static`, and so the sitemap could not list any course:
// the read has to happen at request time. It revalidates hourly —
// a course catalog does not change minute by minute, and a sitemap that queries the
// database on every crawler hit is a waste.
export const revalidate = 3600;

// Public, indexable surfaces only. Authenticated app routes
// (/learn, /teach, /ops, /account) and auth/onboarding flow routes
// are intentionally excluded and disallowed in robots.ts.
const publicRoutes: Array<{
  path: string;
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
  priority: number;
}> = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  // /courses only gets in with a real published course (see below).
  { path: "/for-creators", changeFrequency: "weekly", priority: 0.9 },
  { path: "/how-it-works", changeFrequency: "monthly", priority: 0.8 },
  { path: "/pricing", changeFrequency: "monthly", priority: 0.8 },
  { path: "/promise", changeFrequency: "monthly", priority: 0.8 },
  // Linked from the footer on every page (trust, fees-and-payouts) and from
  // /promise (changelog), public and not disallowed in robots.ts — they just
  // never made it into this array, so sitemap consumers had to discover them
  // by crawl. /fees-and-payouts carries the commission + refund policy.
  { path: "/fees-and-payouts", changeFrequency: "monthly", priority: 0.8 },
  { path: "/refund-policy", changeFrequency: "yearly", priority: 0.5 },
  { path: "/trust", changeFrequency: "monthly", priority: 0.7 },
  { path: "/promise/changelog", changeFrequency: "monthly", priority: 0.4 },
  { path: "/about", changeFrequency: "monthly", priority: 0.6 },
  { path: "/help", changeFrequency: "monthly", priority: 0.6 },
  { path: "/contact", changeFrequency: "yearly", priority: 0.4 },
  { path: "/verify", changeFrequency: "monthly", priority: 0.4 },
  { path: "/legal/terms", changeFrequency: "yearly", priority: 0.3 },
  { path: "/legal/privacy", changeFrequency: "yearly", priority: 0.3 },
  { path: "/legal/teacher-terms", changeFrequency: "yearly", priority: 0.3 },
  { path: "/legal/copyright", changeFrequency: "yearly", priority: 0.3 },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const lastModified = new Date();

  const staticEntries = publicRoutes.map((route) => ({
    url: `${SITE_URL}${route.path}`,
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));

  // PUBLISHED creator courses, one per URL. This was impossible before for two
  // reasons that were fixed today: the sitemap was `force-static` (it could not query the
  // database) and the anonymous read aborted with 42501.
  //
  // The 6 courses of the demo catalog stay OUT on purpose: nobody
  // can buy them, and listing them made search engines index six ghost product
  // pages. Only courses with a row in `courses` and status `published` get in here
  // — the ones that exist to be sold — minus the internal test ones.
  //
  // A read failure returns an empty list (see public-course.ts): the sitemap loses
  // the courses in that revalidation instead of taking down the whole route.
  const [courses, hasRealCourses] = await Promise.all([
    listPublishedCourses(),
    hasRealPublishedCourse(),
  ]);

  // A store without a real course is not a page worth indexing. Same check as the
  // home (anonymous, cached), not the size of the list above.
  // The instructor directory follows the store (#471): without a real course, it would only
  // list profiles with nothing for sale.
  const storeEntry = hasRealCourses
    ? [
        { url: `${SITE_URL}/courses`, lastModified, changeFrequency: "daily" as const, priority: 0.9 },
        { url: `${SITE_URL}/instructors`, lastModified, changeFrequency: "weekly" as const, priority: 0.7 },
      ]
    : [];

  const courseEntries = courses.map((course) => ({
    url: `${SITE_URL}/courses/${course.urlSlug}`,
    lastModified: course.updatedAt ? new Date(course.updatedAt) : lastModified,
    changeFrequency: "weekly" as const,
    priority: 0.8,
  }));

  return [...staticEntries, ...storeEntry, ...courseEntries];
}
