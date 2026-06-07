import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/seo/page-metadata";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/auth",
          "/loading",
          "/welcome",
          "/onboarding",
          "/learn",
          "/teach",
          "/ops",
          "/account",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
