import type { MetadataRoute } from "next";

import { brand } from "@/data/brand";

export const dynamic = "force-static";

// Served at /manifest.webmanifest. Colors and vector icons mirror the official
// SkillsetMind identity handoff.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: brand.title,
    short_name: brand.shortName,
    description: brand.description,
    start_url: "/",
    display: "standalone",
    background_color: "#F7F6F2",
    theme_color: "#102A43",
    icons: [
      {
        src: brand.logoMark,
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: brand.faviconUrl,
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
