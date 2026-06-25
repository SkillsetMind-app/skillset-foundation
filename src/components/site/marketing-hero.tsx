import Image from "next/image";

import { HeroCtas } from "@/components/site/hero-ctas";
import { HeroSignupCard } from "@/components/site/hero-signup-card";

// Brand hero portrait (navy backdrop so it melts into the hero). Three
// candidates live in public/brand/hero/ — swap this one line to switch:
//   hero-person-a.png  woman, blazer, smartphone (Hotmart-style, default)
//   hero-person-b.png  woman, curly hair, presenting gesture, tablet
//   hero-person-c.png  man, blazer, tablet
// Set to null to fall back to the clean navy gradient + signup card.
const HERO_PERSON_SRC: string | null = "/brand/hero/hero-person-a.png";

export function MarketingHero() {
  // Keep the hero behind the floating nav while fitting the primary CTA
  // inside the first viewport on standard desktop screens.
  return (
    <section className="relative -mt-24 flex min-h-[100svh] items-center overflow-hidden bg-[var(--color-primary)] text-white lg:-mt-32">
      <div className="absolute inset-0 bg-gradient-to-br from-[#07172a] via-[#102944] to-[#1a365d]" />
      <div
        className="absolute inset-0 opacity-[0.14]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 16% 26%, rgba(255,255,255,0.40), transparent 34%), radial-gradient(circle at 82% 60%, rgba(178,34,52,0.50), transparent 38%)",
        }}
      />

      {/* Ultra-wide person bleed (Hotmart-style). Sits center-right behind the
          z-10 content; its left edge is masked into the navy so the subject
          melts into the gradient. Rendered only when a real asset exists. */}
      {HERO_PERSON_SRC ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 hidden w-[62%] lg:block"
          style={{
            maskImage:
              "linear-gradient(to right, transparent 0%, rgba(0,0,0,0.6) 22%, #000 45%)",
            WebkitMaskImage:
              "linear-gradient(to right, transparent 0%, rgba(0,0,0,0.6) 22%, #000 45%)",
          }}
        >
          <Image
            src={HERO_PERSON_SRC}
            alt=""
            fill
            priority
            sizes="62vw"
            className="object-cover object-[center_top]"
          />
        </div>
      ) : null}

      <div className="mx-auto w-full max-w-7xl px-5 pb-8 pt-28 sm:px-8 sm:pb-10 sm:pt-32 lg:pb-12 lg:pt-36">
        <div className="relative z-10 grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:gap-14">
          <div className="mx-auto flex max-w-3xl flex-col items-center text-center lg:mx-0 lg:items-start lg:text-left">
            <div className="inline-flex w-fit rounded-[8px] border border-white/20 bg-white/10 px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white">
              For independent experts who want to teach for a living
            </div>
            <div className="mt-4 space-y-3 sm:mt-5 lg:mt-6">
              {/* Split the second sentence so the value prop stays readable without making the fold too tall. */}
              <h1 className="display-title text-[clamp(2.5rem,5vw,4rem)] leading-[1.08] text-white">
                Turn your expertise into a global course business.
                <span className="mt-2 block text-[clamp(1.7rem,3.2vw,2.8rem)] leading-[1.12] text-white/62">
                  Without building a website, hiring a developer, or
                  stitching tools together.
                </span>
              </h1>
              <p className="max-w-[38rem] text-[15px] leading-[1.6] text-white/82 sm:text-base">
                Publish a reviewed program in days. Skillset handles checkout
                in 30+ currencies, the student workspace, the course community,
                and your payouts - so you can spend your week teaching, not
                configuring software.
              </p>
              <HeroCtas />
            </div>
            {/* Keep trust signals below the CTA on tablet/desktop; mobile prioritizes the primary action. */}
            <dl className="mt-7 hidden w-full max-w-2xl gap-4 border-t border-white/20 pt-4 text-left sm:grid sm:grid-cols-3 lg:mt-8">
              {[
                [
                  "Reviewed",
                  "Every program on the marketplace goes through Skillset review.",
                ],
                [
                  "Global",
                  "Multi-currency checkout in 30+ currencies via Stripe.",
                ],
                [
                  "Verifiable",
                  "Every certificate has a public verification URL.",
                ],
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

          {/* Right column: conversion card (Hotmart-style "create account, free"). */}
          <div className="mx-auto w-full max-w-[420px] lg:mx-0 lg:justify-self-end">
            <HeroSignupCard />
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-[var(--color-accent)]" />
      </div>
    </section>
  );
}
