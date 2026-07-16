import type { MetadataRoute } from "next";

import { brand } from "@/data/brand";

export const dynamic = "force-static";

// Served at /manifest.webmanifest. The solid tile keeps the reversible symbol
// legible against both light and dark browser surfaces.
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
        src: brand.faviconUrl,
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: brand.faviconUrl,
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
