"use client";

import Image from "next/image";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

// The ten faces the brand shows. Shared by the marketing hero and the sign-in
// panel so the two surfaces can never drift apart.
export const BRAND_PORTRAITS = [
  "/brand/hero/01_blonde_expert_green_macbook.png",
  "/brand/hero/02_white_male_tobacco_knit.png",
  "/brand/hero/03_black_female_terracotta_seated.png",
  "/brand/hero/04_black_male_burgundy_polo.png",
  "/brand/hero/05_indian_female_aubergine_notebook.png",
  "/brand/hero/06_middle_eastern_male_petrol_notebook.png",
  "/brand/hero/07_east_asian_female_offwhite_tablet.png",
  "/brand/hero/08_east_asian_male_camel_blazer.png",
  "/brand/hero/09_brazilian_latina_emerald_blouse.png",
  "/brand/hero/10_brazilian_latino_burgundy_knit.png",
] as const;

/** How long each face stays on screen before the next one fades in. */
export const PORTRAIT_INTERVAL_MS = 7_000;
/** Length of the crossfade between two faces. */
export const PORTRAIT_FADE_MS = 700;

type BrandPortraitProps = {
  /** Carries object-fit and object-position so each surface keeps its own framing. */
  imageClassName: string;
  sizes: string;
  /** Marks the portrait as LCP-critical. */
  priority?: boolean;
  /**
   * Crossfade to another face every PORTRAIT_INTERVAL_MS. Off by default:
   * the sign-in panel holds still; only the homepage hero rotates.
   */
  rotate?: boolean;
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
 * The brand portrait: one face drawn at random per visit, shared by every
 * BrandPortrait on the page. With `rotate` (the homepage hero) it keeps
 * crossfading through the other faces; without it (sign-in) it holds still.
 *
 * Static rendering has no per-visitor randomness, so the server leaves the
 * slot empty and the client fills it right after hydration — one download, no
 * swap, and nothing for hydration to disagree about. The first face is the
 * LCP candidate either way (`priority`, same `sizes`).
 */
export function BrandPortrait({
  imageClassName,
  sizes,
  priority = false,
  rotate = false,
}: BrandPortraitProps) {
  const index = useSyncExternalStore(subscribe, getDrawnIndex, getServerIndex);

  if (index === null) {
    return null;
  }

  if (rotate) {
    return (
      <RotatingPortrait
        first={index}
        imageClassName={imageClassName}
        sizes={sizes}
        priority={priority}
      />
    );
  }

  return (
    <Image
      src={BRAND_PORTRAITS[index]}
      alt=""
      fill
      priority={priority}
      quality={90}
      sizes={sizes}
      className={imageClassName}
    />
  );
}

type Layer = 0 | 1;

// Fisher–Yates, in place.
function shuffle(list: number[]) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/**
 * Two stacked layers with stable identity: only their `src` changes, so a
 * face never remounts (a remount plus async decode is what used to flash the
 * dark background). Right after a fade ends the hidden layer receives the next
 * face, giving it the whole interval to load; a tick only flips once that
 * image is complete. The incoming layer fades in on top; the outgoing one
 * stays opaque underneath until the fade is over, then drops out unseen — no
 * mid-fade dip to the background.
 *
 * Order: the other nine faces, shuffled; when they run out, reshuffle without
 * the face on screen. Never the same face twice in a row.
 *
 * Holds still under prefers-reduced-motion (checked at mount and again after
 * every flip) and pauses while the tab is hidden.
 */
function RotatingPortrait({
  first,
  imageClassName,
  sizes,
  priority,
}: {
  first: number;
  imageClassName: string;
  sizes: string;
  priority: boolean;
}) {
  const [shown, setShown] = useState<Layer>(0);
  const [faces, setFaces] = useState<[number, number | null]>([first, null]);
  const layer0 = useRef<HTMLImageElement>(null);
  const layer1 = useRef<HTMLImageElement>(null);
  const deck = useRef({ last: first, queue: [] as number[] });

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const hidden: Layer = shown === 0 ? 1 : 0;
    const hiddenImage = hidden === 0 ? layer0 : layer1;

    // A fade just ended (or we just mounted): load the next face into the
    // hidden layer now, so it is cached long before it has to show.
    const preload = window.setTimeout(() => {
      const d = deck.current;
      if (d.queue.length === 0) {
        d.queue = shuffle(
          BRAND_PORTRAITS.map((_, i) => i).filter((i) => i !== d.last),
        );
      }
      d.last = d.queue.shift()!;
      const next = d.last;
      setFaces((f) => (hidden === 0 ? [next, f[1]] : [f[0], next]));
    }, PORTRAIT_FADE_MS);

    let interval: number | undefined;
    const start = () => {
      if (interval !== undefined) return;
      interval = window.setInterval(() => {
        // Still loading (slow network): wait for the next tick rather than
        // fade in a blank layer.
        if (!hiddenImage.current?.complete) return;
        setShown(hidden);
      }, PORTRAIT_INTERVAL_MS);
    };
    const stop = () => {
      window.clearInterval(interval);
      interval = undefined;
    };
    const sync = () =>
      document.visibilityState === "hidden" ? stop() : start();

    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.clearTimeout(preload);
      stop();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [shown]);

  return faces.map((face, layer) =>
    face === null ? null : (
      <Image
        key={layer}
        ref={layer === 0 ? layer0 : layer1}
        src={BRAND_PORTRAITS[face]}
        alt=""
        aria-hidden={layer === shown ? undefined : true}
        fill
        loading="eager"
        priority={priority && layer === 0 && face === first}
        quality={90}
        sizes={sizes}
        className={imageClassName}
        style={
          layer === shown
            ? { zIndex: 1, transition: `opacity ${PORTRAIT_FADE_MS}ms ease-in-out` }
            : {
                zIndex: 0,
                opacity: 0,
                // Stay opaque under the incoming layer for the whole fade,
                // then drop out once it is fully covered.
                transition: `opacity 0s linear ${PORTRAIT_FADE_MS}ms`,
              }
        }
      />
    ),
  );
}
