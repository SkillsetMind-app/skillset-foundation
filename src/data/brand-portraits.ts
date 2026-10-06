// Plain module (no "use client") so a server component can draw a face too.
// The ten faces the brand shows, as lossless masters (pixel-identical to the
// original PNGs, which stay in the repo). next/image turns them into AVIF/WebP.
// Shared by the marketing hero and the sign-in
// panel so the two surfaces can never drift apart.
export const BRAND_PORTRAITS = [
  "/brand/hero/01_blonde_expert_green_macbook-master.webp",
  "/brand/hero/02_white_male_tobacco_knit-master.webp",
  "/brand/hero/03_black_female_terracotta_seated-master.webp",
  "/brand/hero/04_black_male_burgundy_polo-master.webp",
  "/brand/hero/05_indian_female_aubergine_notebook-master.webp",
  "/brand/hero/06_middle_eastern_male_petrol_notebook-master.webp",
  "/brand/hero/07_east_asian_female_offwhite_tablet-master.webp",
  "/brand/hero/08_east_asian_male_camel_blazer-master.webp",
  "/brand/hero/09_brazilian_latina_emerald_blouse-master.webp",
  "/brand/hero/10_brazilian_latino_burgundy_knit-master.webp",
] as const;

/** One uniformly random face index. */
export function drawPortraitIndex(): number {
  return Math.floor(Math.random() * BRAND_PORTRAITS.length);
}
