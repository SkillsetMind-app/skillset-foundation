import { BrandPortrait } from "@/components/shared/brand-portrait";
import { HeroCtas } from "@/components/site/hero-ctas";
import { getServerTranslation } from "@/lib/i18n/server";

// Server component: só texto traduzido, nada de estado. O que tem estado é a
// ilha HeroCtas, que continua cliente.
export async function MarketingHero() {
  const { t } = await getServerTranslation();
  // Nada de margem negativa: o cabeçalho virou barra fixa com faixa própria,
  // então o hero só começa embaixo dela. O encaixe por -mt-24/-mt-32 dependia
  // da altura exata do cabeçalho flutuante e quebrava quando ela mudava.
  // A altura mínima é um clamp: em janela baixa (560px) o botão principal
  // ainda cabe na primeira tela, em telão ela para de crescer aos 900px.
  return (
    <section className="relative flex min-h-[clamp(560px,92svh,900px)] items-center overflow-hidden bg-[var(--color-primary)] text-white">
      <div className="absolute inset-0 bg-gradient-to-br from-[#071523] via-[#102a43] to-[#173a59]" />

      {/* One still portrait per visit — see BrandPortrait. */}
      <div aria-hidden="true" className="absolute inset-0">
        <div className="hero-portrait-layer absolute inset-0 opacity-65 lg:opacity-100">
          <BrandPortrait
            imageClassName="hero-portrait-image object-cover object-[78%_center] sm:object-[74%_center] md:object-[68%_center] lg:object-center"
            sizes="100vw"
            priority
          />
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

      <div className="mx-auto w-full max-w-7xl px-5 py-12 sm:px-8 sm:py-14 lg:py-16">
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
