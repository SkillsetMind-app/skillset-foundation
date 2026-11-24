import Image from "next/image";

import { RevealSection } from "@/components/shared/reveal-section";
import { getServerTranslation } from "@/lib/i18n/server";

// "Para quem é": só frases que o site já publica (o público da faixa final e a
// linha do topo sobre psicólogos que ensinam). As três fotos são de gente que
// não existe, feitas por IA: sem nome, sem frase, nada com cara de depoimento
// ou de cliente. O texto alternativo descreve a cena, não a pessoa.
const PORTRAITS = [
  { src: "/brand/home/home-who-coach.avif", alt: "home.who.coachAlt" },
  { src: "/brand/home/home-who-teacher.avif", alt: "home.who.teacherAlt" },
  { src: "/brand/home/home-who-educator.avif", alt: "home.who.educatorAlt" },
] as const;

// Server component, sem estado. No celular os retratos ficam um embaixo do
// outro, recortados em 4:3 (o rosto fica no quadro); do md para cima, três
// colunas em 4:5. O movimento existe só no globals.css (computador).
export async function HomeWhoFor() {
  const { t } = await getServerTranslation();

  return (
    <section
      aria-labelledby="home-who-title"
      className="mx-auto w-full max-w-7xl px-5 py-16 sm:px-8 sm:py-20 lg:py-24"
    >
      <RevealSection className="home-heading max-w-4xl">
        <h2 className="display-title text-[clamp(2.25rem,4.2vw,3.25rem)] leading-[1.05] text-[var(--color-primary)]" id="home-who-title">
          {t("home.creators.eyebrow")}
        </h2>
        <p className="mt-4 max-w-xl text-[1.0625rem] leading-[1.6] text-[var(--color-ink)] md:text-lg">
          {t("home.hero.alsoFor")}
        </p>
      </RevealSection>
      <div className="mt-10 grid gap-5 sm:mt-12 md:grid-cols-3">
        {PORTRAITS.map(({ src, alt }) => (
          <div key={src} className="home-who__photo relative aspect-[4/3] overflow-hidden rounded-lg md:aspect-[4/5]">
            <Image
              src={src}
              alt={t(alt)}
              fill
              sizes="(min-width: 1280px) 392px, (min-width: 768px) 31vw, 100vw"
              className="object-cover object-[center_25%]"
            />
          </div>
        ))}
      </div>
    </section>
  );
}
