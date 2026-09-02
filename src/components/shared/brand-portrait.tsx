"use client";

import Image from "next/image";
import { useSyncExternalStore } from "react";

// The ten faces the brand shows. Shared by the marketing hero and the sign-in
// panel so the two surfaces can never drift apart.
export const BRAND_PORTRAITS = [
  "/brand/hero/01_blonde_expert_green_macbook.webp",
  "/brand/hero/02_white_male_tobacco_knit.webp",
  "/brand/hero/03_black_female_terracotta_seated.webp",
  "/brand/hero/04_black_male_burgundy_polo.webp",
  "/brand/hero/05_indian_female_aubergine_notebook.webp",
  "/brand/hero/06_middle_eastern_male_petrol_notebook.webp",
  "/brand/hero/07_east_asian_female_offwhite_tablet.webp",
  "/brand/hero/08_east_asian_male_camel_blazer.webp",
  "/brand/hero/09_brazilian_latina_emerald_blouse.webp",
  "/brand/hero/10_brazilian_latino_burgundy_knit.webp",
] as const;

type BrandPortraitProps = {
  /** Carries object-fit and object-position so each surface keeps its own framing. */
  imageClassName: string;
  sizes: string;
  /** Marks the portrait as LCP-critical. */
  priority?: boolean;
};

// One draw per page load, shared by every BrandPortrait on the page: a visitor
// who clicks through from the hero to sign-in keeps seeing the same face, and a
// fresh load draws again.
let drawnIndex: number | null = null;
const subscribe = () => () => {};
function getDrawnIndex() {
  if (drawnIndex === null) {
    drawnIndex = Math.floor(Math.random() * BRAND_PORTRAITS.length);
  }
  return drawnIndex;
}
const getServerIndex = () => null;

/**
 * A single still portrait, picked at random once per visit. Nothing rotates:
 * the page used to crossfade through all ten every three seconds, which made
 * the hero and the sign-in panel feel like they never held still.
 *
 * Static rendering has no per-visitor randomness, so the server leaves the
 * slot empty and the client fills it right after hydration — one download, no
 * swap. Under prefers-reduced-motion there is simply nothing left to reduce.
 */
export function BrandPortrait({
  imageClassName,
  sizes,
  priority = false,
}: BrandPortraitProps) {
  const index = useSyncExternalStore(subscribe, getDrawnIndex, getServerIndex);

  if (index === null) {
    return null;
  }

  return (
    <Image
      src={BRAND_PORTRAITS[index]}
      alt=""
      fill
      priority={priority}
      sizes={sizes}
      className={imageClassName}
    />
  );
}
