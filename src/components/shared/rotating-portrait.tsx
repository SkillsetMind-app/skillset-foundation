"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

// The ten faces the brand shows. Shared by the marketing hero and the sign-in
// showcase panel so the two surfaces can never drift apart — a visitor who
// clicks through from the homepage keeps seeing the same people.
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

const PORTRAIT_INTERVAL_MS = 3_000;
// Must match the duration-[...] utility callers pass in imageClassName.
const PORTRAIT_FADE_MS = 1_400;

type RotatingPortraitProps = {
  /**
   * Applied to both layers. Carries object-fit, object-position and the
   * transition-opacity duration, so each surface keeps its own framing.
   */
  imageClassName: string;
  sizes: string;
  /** Marks the very first portrait as LCP-critical. */
  priority?: boolean;
};

/**
 * Two stacked full-bleed layers that crossfade through BRAND_PORTRAITS. Keeping
 * the upcoming portrait mounted warms the browser cache, so a transition starts
 * immediately instead of flashing while it loads.
 *
 * Honours prefers-reduced-motion: with it on, the timer never starts and one
 * portrait stays put. The listener stays attached, so toggling the preference
 * mid-visit takes effect without a reload.
 */
export function RotatingPortrait({
  imageClassName,
  sizes,
  priority = false,
}: RotatingPortraitProps) {
  const activeIndexRef = useRef(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);

  useEffect(() => {
    const reducedMotion =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    let intervalId: number | undefined;
    let transitionTimeoutId: number | undefined;

    const stopTimers = () => {
      if (intervalId !== undefined) window.clearInterval(intervalId);
      if (transitionTimeoutId !== undefined) {
        window.clearTimeout(transitionTimeoutId);
      }
      intervalId = undefined;
      transitionTimeoutId = undefined;
    };

    const startCycle = () => {
      intervalId = window.setInterval(() => {
        setIsTransitioning(true);
        transitionTimeoutId = window.setTimeout(() => {
          const nextIndex =
            (activeIndexRef.current + 1) % BRAND_PORTRAITS.length;
          activeIndexRef.current = nextIndex;
          setActiveIndex(nextIndex);
          setIsTransitioning(false);
          transitionTimeoutId = undefined;
        }, PORTRAIT_FADE_MS);
      }, PORTRAIT_INTERVAL_MS);
    };

    // No matchMedia (old browser, jsdom) means no way to read the preference,
    // so stay still rather than animate against someone's wishes.
    if (!reducedMotion) return stopTimers;

    const handleMotionPreference = () => {
      stopTimers();
      setIsTransitioning(false);
      if (!reducedMotion.matches) startCycle();
    };

    if (!reducedMotion.matches) startCycle();
    reducedMotion.addEventListener("change", handleMotionPreference);

    return () => {
      stopTimers();
      reducedMotion.removeEventListener("change", handleMotionPreference);
    };
  }, []);

  const nextIndex = (activeIndex + 1) % BRAND_PORTRAITS.length;

  return (
    <>
      <Image
        key={`active-${BRAND_PORTRAITS[activeIndex]}`}
        src={BRAND_PORTRAITS[activeIndex]}
        alt=""
        fill
        priority={priority && activeIndex === 0}
        sizes={sizes}
        className={`${imageClassName} ${
          isTransitioning ? "opacity-0" : "opacity-100"
        }`}
      />
      <Image
        key={`next-${BRAND_PORTRAITS[nextIndex]}`}
        src={BRAND_PORTRAITS[nextIndex]}
        alt=""
        fill
        loading="lazy"
        sizes={sizes}
        className={`${imageClassName} ${
          isTransitioning ? "opacity-100" : "opacity-0"
        }`}
      />
    </>
  );
}
