import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/seo/page-metadata";

export const dynamic = "force-static";

// Public, indexable surfaces only. Authenticated app routes
// (/learn, /teach, /ops, /account) and auth/onboarding flow routes
// are intentionally excluded and disallowed in robots.ts.
const publicRoutes: Array<{
  path: string;
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
  priority: number;
}> = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/courses", changeFrequency: "daily", priority: 0.9 },
  { path: "/for-creators", changeFrequency: "weekly", priority: 0.9 },
  { path: "/pricing", changeFrequency: "monthly", priority: 0.8 },
  { path: "/promise", changeFrequency: "monthly", priority: 0.8 },
  // Linked from the footer on every page (trust, fees-and-payouts) and from
  // /promise (changelog), public and not disallowed in robots.ts — they just
  // never made it into this array, so sitemap consumers had to discover them
  // by crawl. /fees-and-payouts carries the commission + refund policy.
  { path: "/fees-and-payouts", changeFrequency: "monthly", priority: 0.8 },
  { path: "/trust", changeFrequency: "monthly", priority: 0.7 },
  { path: "/promise/changelog", changeFrequency: "monthly", priority: 0.4 },
  { path: "/instructors", changeFrequency: "weekly", priority: 0.7 },
  { path: "/about", changeFrequency: "monthly", priority: 0.6 },
  { path: "/help", changeFrequency: "monthly", priority: 0.6 },
  { path: "/contact", changeFrequency: "yearly", priority: 0.4 },
  { path: "/verify", changeFrequency: "monthly", priority: 0.4 },
  { path: "/legal/terms", changeFrequency: "yearly", priority: 0.3 },
  { path: "/legal/privacy", changeFrequency: "yearly", priority: 0.3 },
  { path: "/legal/teacher-terms", changeFrequency: "yearly", priority: 0.3 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  const staticEntries = publicRoutes.map((route) => ({
    url: `${SITE_URL}${route.path}`,
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));

  // Per-course URLs are deliberately absent. The only enumerable slugs here come
  // from the static demo catalog, i.e. courses nobody can actually buy — listing
  // them had search engines indexing six phantom product pages. Real creator
  // courses resolve client-side and cannot be enumerated in a `force-static`
  // sitemap anyway; /courses is the crawlable entry point for them.
  return staticEntries;
}
