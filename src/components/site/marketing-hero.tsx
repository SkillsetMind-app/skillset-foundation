import Image from "next/image";

import { HeroCtas } from "@/components/site/hero-ctas";
import { HeroSignupCard } from "@/components/site/hero-signup-card";

// Centered hero figure (Hotmart-style): a wide photo of a woman on a navy
// backdrop so it melts into the hero. Lives behind the copy + card and shows
// through the clear center. Set to null to fall back to the navy gradient.
//   hero-woman-1.png  ultrawide woman, centered, gpt-image-2 (default)
const HERO_PERSON_SRC: string | null = "/brand/hero/hero-woman-1.png";

export function MarketingHero() {
  // Keep the hero behind the floating nav while fitting the primary CTA
  // inside the first viewport on standard desktop screens.
  return (
    <section className="relative -mt-24 flex min-h-[100svh] items-center overflow-hidden bg-[var(--color-primary)] text-white lg:-mt-32">
      <div className="absolute inset-0 bg-gradient-to-br from-[#07172a] via-[#102944] to-[#1a365d]" />

      {/* Centered woman behind the content (desktop only — mobile keeps the
          clean gradient so the CTA stays prominent). The photo already sits on
          navy, so its edges melt into the hero; the scrim darkens the copy
          (left) and card (right) zones while the center stays clear. */}
      {HERO_PERSON_SRC ? (
        <div aria-hidden="true" className="absolute inset-0 hidden lg:block">
          {/* object-contain (not cover): the source is a 3:2 portrait with the
              subject framed head-to-hands on navy. cover into a full-viewport
              hero cropped her forehead/eyes (top) and hands/phone (bottom).
              contain shows the whole figure; the source's navy sides melt into
              the pillarbox, and object-bottom turns any slack into headroom. */}
          <Image
            src={HERO_PERSON_SRC}
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-contain object-bottom"
          />
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                "linear-gradient(to right, rgba(7,23,42,0.94) 0%, rgba(7,23,42,0.58) 24%, rgba(7,23,42,0.04) 44%, rgba(7,23,42,0.04) 58%, rgba(7,23,42,0.55) 80%, rgba(7,23,42,0.84) 100%)",
            }}
          />
        </div>
      ) : null}

      <div
        className="absolute inset-0 opacity-[0.12]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 82% 62%, rgba(178,34,52,0.50), transparent 40%)",
        }}
      />

      <div className="mx-auto w-full max-w-7xl px-5 pb-8 pt-28 sm:px-8 sm:pb-10 sm:pt-32 lg:pb-12 lg:pt-36">
        <div className="relative z-10 flex flex-col gap-10 lg:flex-row lg:items-center lg:justify-between lg:gap-12">
          <div className="mx-auto flex max-w-xl flex-col items-center text-center lg:mx-0 lg:items-start lg:text-left">
            <div className="inline-flex w-fit rounded-[8px] border border-white/20 bg-white/10 px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white">
              For independent experts
            </div>
            <div className="mt-5 space-y-4 lg:mt-6">
              {/* One sentence, two lines — short and direct. */}
              <h1 className="display-title text-[clamp(2.3rem,4.6vw,3.6rem)] leading-[1.07] text-white">
                Make a living
                <span className="block">teaching what you know.</span>
              </h1>
              <p className="max-w-[34rem] text-[15px] leading-[1.6] text-white/82 sm:text-base">
                No site to build. No tools to wire up. We run the checkout, the
                classroom, and your payouts. You teach.
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

          {/* Conversion card (Hotmart-style "create account, free"). */}
          <div className="mx-auto w-full max-w-[380px] lg:mx-0 lg:shrink-0">
            <HeroSignupCard />
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-[var(--color-accent)]" />
      </div>
    </section>
  );
}
