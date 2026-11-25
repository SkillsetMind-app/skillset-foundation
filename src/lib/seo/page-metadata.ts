import type { Metadata } from "next";

import { brand } from "@/data/brand";

// `www` is the canonical host in production: the apex answers with a 301 to
// here (checked by browsing to https://skillsetmind.com, which redirects). While
// this constant pointed to the apex, EVERY page declared itself canonical at an
// address that redirects, and the whole sitemap listed redirected URLs —
// search engines treat a redirect as a weakened signal.
export const SITE_URL = "https://www.skillsetmind.com";

type PageMetadataInput = {
  title: string;
  description: string;
  path: string;
  noindex?: boolean;
  /**
   * Share card image. Absolute (a course cover comes from Bunny/Supabase) or
   * starting with "/" for a local asset. Without this, every card came out
   * with the brand logo — the same card for every course in the catalog.
   */
  image?: string | null;
};

/**
 * Builds consistent, per-page SEO metadata (title, description, canonical,
 * Open Graph, Twitter). Without this every public page inherited the single
 * root-layout title/description, which is bad for SEO and link sharing.
 */
export function buildPageMetadata({
  title,
  description,
  path,
  noindex = false,
  image = null,
}: PageMetadataInput): Metadata {
  const fullTitle = `${title} | ${brand.name}`;
  const url = `${SITE_URL}${path}`;
  // Accepts an absolute URL (hosted cover) or a local path; with no image of
  // its own, it falls back to the 1200×630 card from src/app/opengraph-image.tsx.
  // It used to be the 1600×320 logo, which WhatsApp and LinkedIn cut in half on
  // the large card.
  const shareImage = image
    ? { url: image.startsWith("http") ? image : `${SITE_URL}${image}` }
    : { url: `${SITE_URL}/opengraph-image`, width: 1200, height: 630 };

  return {
    title: fullTitle,
    description,
    alternates: { canonical: url },
    robots: noindex
      ? { index: false, follow: false }
      : { index: true, follow: true },
    openGraph: {
      type: "website",
      siteName: brand.name,
      title: fullTitle,
      description,
      url,
      images: [shareImage],
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description,
      images: [shareImage.url],
    },
  };
}
