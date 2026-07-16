"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { HeroCtas } from "@/components/site/hero-ctas";

const HERO_PORTRAITS = [
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

const HERO_PORTRAIT_INTERVAL_MS = 8_000;
const HERO_PORTRAIT_FADE_MS = 1_400;

export function MarketingHero() {
  const { t } = useTranslation();
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
            (activeIndexRef.current + 1) % HERO_PORTRAITS.length;
          activeIndexRef.current = nextIndex;
          setActiveIndex(nextIndex);
          setIsTransitioning(false);
          transitionTimeoutId = undefined;
        }, HERO_PORTRAIT_FADE_MS);
      }, HERO_PORTRAIT_INTERVAL_MS);
    };

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

  const nextIndex = (activeIndex + 1) % HERO_PORTRAITS.length;
  // Keep the hero behind the floating nav while fitting the primary CTA
  // inside the first viewport on standard desktop screens.
  return (
    <section className="relative -mt-24 flex min-h-[100svh] items-center overflow-hidden bg-[var(--color-primary)] text-white lg:-mt-32">
      <div className="absolute inset-0 bg-gradient-to-br from-[#071523] via-[#102a43] to-[#173a59]" />

      {/* Two full-bleed layers keep the upcoming portrait warm in the browser
          cache, so each transition starts immediately without loading flashes. */}
      <div aria-hidden="true" className="absolute inset-0 hidden lg:block">
        <div className="absolute inset-0">
          <Image
            key={`active-${HERO_PORTRAITS[activeIndex]}`}
            src={HERO_PORTRAITS[activeIndex]}
            alt=""
            fill
            priority={activeIndex === 0}
            sizes="100vw"
            className={`object-cover object-center transition-opacity duration-[1400ms] ease-in-out motion-reduce:transition-none ${
              isTransitioning ? "opacity-0" : "opacity-100"
            }`}
          />
          <Image
            key={`next-${HERO_PORTRAITS[nextIndex]}`}
            src={HERO_PORTRAITS[nextIndex]}
            alt=""
            fill
            loading="lazy"
            sizes="100vw"
            className={`object-cover object-center transition-opacity duration-[1400ms] ease-in-out motion-reduce:transition-none ${
              isTransitioning ? "opacity-100" : "opacity-0"
            }`}
          />
        </div>
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                "linear-gradient(to right, rgba(7,23,42,0.95) 0%, rgba(7,23,42,0.85) 28%, rgba(7,23,42,0.42) 52%, rgba(7,23,42,0.05) 74%, rgba(7,23,42,0) 100%)",
            }}
          />
      </div>

      {/* Bottom vignette — melts the photo's waist crop into the accent bar
          so there's no hard horizontal seam. Section-wide, so mobile's plain
          gradient gains the same grounded base. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-40"
        style={{
          backgroundImage:
            "linear-gradient(to top, rgba(7,23,42,0.9) 0%, rgba(7,23,42,0.5) 38%, transparent 100%)",
        }}
      />

      {/* Film grain — a ~4% fractal-noise overlay (soft-light) that breaks up the
          flat navy so the large gradient fill doesn't band on wide/OLED screens
          and the hero reads as textured rather than printed. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-[0.04] mix-blend-soft-light"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
          backgroundSize: "200px 200px",
        }}
      />

      <div className="mx-auto w-full max-w-7xl px-5 pb-8 pt-28 sm:px-8 sm:pb-10 sm:pt-32 lg:pb-12 lg:pt-36">
        <div className="relative z-10 flex flex-col gap-10 lg:flex-row lg:items-center">
          <div className="hero-copy-rise mx-auto flex max-w-xl flex-col items-center text-center lg:mx-0 lg:items-start lg:text-left">
            <div className="inline-flex w-fit rounded-[8px] border border-white/20 bg-white/10 px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white">
              {t("home.hero.eyebrow")}
            </div>
            <div className="mt-5 space-y-4 lg:mt-6">
              {/* One sentence, two lines — short and direct. */}
              <h1 className="display-title text-[clamp(2.3rem,4.6vw,3.6rem)] leading-[1.07] text-white">
                {t("home.hero.title1")}
                <span className="block">{t("home.hero.title2")}</span>
              </h1>
              <p className="max-w-[34rem] text-[15px] leading-[1.6] text-white/82 sm:text-base">
                {t("home.hero.sub")}
              </p>
              <HeroCtas />
            </div>
            {/* Keep trust signals below the CTA on tablet/desktop; mobile prioritizes the primary action. */}
            <dl className="mt-7 hidden w-full max-w-2xl gap-4 border-t border-white/20 pt-4 text-left sm:grid sm:grid-cols-3 lg:mt-8">
              {[
                [t("home.hero.trust1Title"), t("home.hero.trust1Desc")],
                [t("home.hero.trust2Title"), t("home.hero.trust2Desc")],
                [t("home.hero.trust3Title"), t("home.hero.trust3Desc")],
              ].map(([value, label]) => (
                <div key={label}>
                  <dt className="text-sm font-bold text-white">{value}</dt>
                  <dd className="mt-1 text-xs leading-5 text-white/66">
                    {label}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-[var(--color-accent)]" />
      </div>
    </section>
  );
}
