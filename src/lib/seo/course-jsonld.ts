import { brand } from "@/data/brand";
import type { Course } from "@/domain/learning";
import { SITE_URL } from "@/lib/seo/page-metadata";

/**
 * Build schema.org `Course` (+ optional `Offer`) JSON-LD for a static catalog
 * course, for organic discovery (C2). Every emitted field is sourced from real
 * `Course` data, with one documented exception — `inLanguage` is a site-wide
 * English-only constant (the catalog `Course` type has no per-course language
 * field). Nothing is fabricated:
 *
 *  - NO `aggregateRating`/`review`: the catalog `Course` type carries no rating
 *    data; a fabricated rating breaches Article IV and draws a Google penalty.
 *  - NO `hasCourseInstance.courseWorkload`: `durationLabel` is free text
 *    ("8-12 weeks"), not an ISO-8601 duration, so we never emit a malformed field.
 *  - `offers` ONLY when the course is actually purchasable RIGHT NOW (the
 *    caller-supplied `purchasable`, derived from the SAME getCourseAccessDecision
 *    the enrollment CTA renders) AND a numeric price exists. This keeps the
 *    structured data consistent with the visible CTA: while checkout is disabled
 *    the page shows "Checkout opening soon", so we emit NO Offer rather than a
 *    false `InStock` (Google requires structured data to match visible content).
 *
 * Creator (Firestore) courses resolve client-side without the Admin SDK, so they
 * are out of scope here; only the build-time static catalog gets server JSON-LD.
 */
export function buildCourseJsonLd(
  course: Course,
  options: { purchasable: boolean; siteUrl?: string },
): Record<string, unknown> {
  const siteUrl = options.siteUrl ?? SITE_URL;
  const url = `${siteUrl}/courses/${course.slug}`;
  const image = /^https?:\/\//.test(course.image)
    ? course.image
    : `${siteUrl}${course.image}`;

  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Course",
    name: course.title,
    description: course.summary,
    url,
    image,
    inLanguage: "en",
    about: course.category,
    educationalLevel: course.level,
    provider: {
      "@type": "Organization",
      name: brand.name,
      url: siteUrl,
    },
  };

  if (course.outcomes.length > 0) {
    data.teaches = course.outcomes;
  }

  // Offer only when the course can actually be enrolled/bought now. A priced
  // course with checkout still disabled renders "Checkout opening soon" on the
  // page, so an InStock Offer would contradict the visible content (an Article IV
  // overclaim and a Google structured-data mismatch).
  if (options.purchasable && typeof course.priceAmountMinor === "number") {
    const priceMinor = course.priceAmountMinor;
    data.offers = {
      "@type": "Offer",
      price: (priceMinor / 100).toFixed(2),
      priceCurrency: course.currency,
      availability: "https://schema.org/InStock",
      category: priceMinor === 0 ? "Free" : "Paid",
      url,
    };
  }

  return data;
}
