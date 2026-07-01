import Image from "next/image";

import { HeroCtas } from "@/components/site/hero-ctas";

// Centered hero figure (Hotmart-style): a wide photo of a woman on a navy
// backdrop so it melts into the hero. Lives behind the copy + card and shows
// through the clear center. Set to null to fall back to the navy gradient.
//   hero-woman-7.png  ~21:9 (1926x816) photoreal portrait — woman in round glasses
//   turned over her shoulder with a warm smile, dark blazer, hugging a MacBook on the
//   brand navy. Subject center-of-mass sits ~58% across (72% of her mass in the right
//   half), leaving wide clean navy on the left for the headline; her face lands in the
//   clear zone past the scrim. object-cover object-center crops only the navy margins
//   and keeps her whole (she spans ~23%-80% of the frame). Do NOT mirror — it flips the
//   Apple logo and shoves her into the copy.
const HERO_PERSON_SRC: string | null = "/brand/hero/hero-woman-7.png";

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
          {/* Full-bleed ultrawide: the source is already 21:9 with the subject
              centered inside wide navy margins, so object-cover fills the hero
              edge-to-edge and only ever crops the navy — her face and hands
              stay intact on every desktop ratio. */}
          <Image
            src={HERO_PERSON_SRC}
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover object-center"
          />
          <div
            className="absolute inset-0"
            style={{
              backgroundImage:
                "linear-gradient(to right, rgba(7,23,42,0.95) 0%, rgba(7,23,42,0.85) 28%, rgba(7,23,42,0.42) 52%, rgba(7,23,42,0.05) 74%, rgba(7,23,42,0) 100%)",
            }}
          />
          {/* Warm rim-light halo at her head/shoulder (~61% x, ~31% y — the
              measured subject peak sits ~59% across). Screen-blended so it reads
              as backlight lifting her off the flat navy, not a wash over the photo. */}
          <div
            className="absolute inset-0 mix-blend-screen"
            style={{
              backgroundImage:
                "radial-gradient(42% 46% at 61% 31%, rgba(255,214,168,0.22), rgba(255,214,168,0.06) 46%, transparent 70%)",
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

      {/* Bottom vignette — melts the photo's waist crop into the red accent bar
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
              For psychology &amp; wellbeing experts
            </div>
            <div className="mt-5 space-y-4 lg:mt-6">
              {/* One sentence, two lines — short and direct. */}
              <h1 className="display-title text-[clamp(2.3rem,4.6vw,3.6rem)] leading-[1.07] text-white">
                Your knowledge changes lives.
                <span className="block">Now let it reach thousands.</span>
              </h1>
              <p className="max-w-[34rem] text-[15px] leading-[1.6] text-white/82 sm:text-base">
                Built for psychologists, therapists, and personal-development
                coaches. No site to build, no tools to wire up. We run the
                checkout, the classroom, and your payouts. You teach.
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
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-[var(--color-accent)]" />
      </div>
    </section>
  );
}
