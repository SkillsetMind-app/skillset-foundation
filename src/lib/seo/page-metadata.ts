import type { Metadata } from "next";

import { brand } from "@/data/brand";

export const SITE_URL = "https://skillsetusaofficial.web.app";

type PageMetadataInput = {
  title: string;
  description: string;
  path: string;
  noindex?: boolean;
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
}: PageMetadataInput): Metadata {
  const fullTitle = `${title} | ${brand.name}`;
  const url = `${SITE_URL}${path}`;
  const ogImage = `${SITE_URL}${brand.logoUrl}`;

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
      images: [{ url: ogImage }],
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description,
      images: [ogImage],
    },
  };
}
