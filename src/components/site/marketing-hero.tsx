import { BrandPortrait } from "@/components/shared/brand-portrait";
import { HeroCtas } from "@/components/site/hero-ctas";
import { drawPortraitIndex } from "@/data/brand-portraits";
import { getServerTranslation } from "@/lib/i18n/server";

// Server component: only translated text, no state. What has state is the
// HeroCtas island, which remains a client component.
export async function MarketingHero() {
  const { t } = await getServerTranslation();
  // The face is drawn here (the home is dynamic: cookies/headers in the layout), and
  // not after hydration: the LCP image goes in the HTML with a preload and starts
  // downloading before any JavaScript.
  const firstPortrait = drawPortraitIndex();
  // No negative margin: the header became a fixed bar with its own strip,
  // so the hero only starts below it. The -mt-24/-mt-32 fit depended on
  // the exact height of the floating header and broke when it changed.
  // The minimum height is a clamp: in a short window (560px) the main button
  // still fits on the first screen, on a big screen it stops growing at 900px.
  return (
    <section className="home-hero relative flex min-h-[clamp(560px,92svh,900px)] items-center overflow-hidden bg-[var(--color-primary)] text-white">
      <div className="absolute inset-0 bg-gradient-to-br from-[#071523] via-[#102a43] to-[#173a59]" />

      {/* Starts on the visit's face and crossfades through the others every
          few seconds — see BrandPortrait. Only the home rotates; sign-in
          keeps its still portrait. */}
      <div aria-hidden="true" className="absolute inset-0">
        <div className="hero-portrait-layer absolute inset-0 opacity-65 lg:opacity-100">
          <div className="hero-portrait-frame absolute inset-y-0 right-0 w-full">
            <BrandPortrait
              rotate
              imageClassName="hero-portrait-image object-cover object-[78%_center] sm:object-[74%_center] md:object-[68%_center] lg:object-[center_top]"
              sizes="100vw"
              priority
              initialIndex={firstPortrait}
            />
          </div>
        </div>
        <div className="absolute inset-0 bg-[#071523]/55 lg:bg-transparent" />
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

      <div className="mx-auto w-full max-w-7xl px-5 py-12 sm:px-8 sm:py-14 lg:py-16">
        <div className="home-hero__copy relative z-10 flex flex-col gap-10 lg:flex-row lg:items-center">
          <div className="hero-copy-rise mx-auto flex max-w-xl flex-col items-center text-center lg:mx-0 lg:max-w-[min(36rem,48%)] lg:items-start lg:text-left">
            {/* flex + gap, not space-y: on phones the supporting text moves
                after the buttons, otherwise the main button ends up under the
                cookie banner on the 1st visit. From `sm` up the order goes back
                to title → support → buttons. */}
            <div className="flex flex-col gap-4">
              {/* The brand phrase comes first (the owner's phrase, mandatory). */}
              <h1 className="display-title text-[clamp(2.3rem,4.6vw,3.6rem)] leading-[1.07] text-white">
                {t("home.hero.brand")}
              </h1>
              <div className="order-last max-w-[34rem] sm:order-none">
                <p className="text-[15px] leading-[1.6] text-white/82 sm:text-base">
                  {t("home.hero.support")}
                </p>
                <p className="mt-2 text-[13px] leading-5 text-white/70">
                  {t("home.hero.alsoFor")}
                </p>
              </div>
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
