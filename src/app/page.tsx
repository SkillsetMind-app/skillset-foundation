import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { CapabilitiesGrid } from "@/components/site/capabilities-grid";
import { FeaturedCourses } from "@/components/site/featured-courses";
import { ForCreatorsBand } from "@/components/site/for-creators-band";
import { HowItWorksStrip } from "@/components/site/how-it-works-strip";
import { MarketingHero } from "@/components/site/marketing-hero";
import { PromisePreviewBand } from "@/components/site/promise-preview-band";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteNav } from "@/components/site/site-nav";
import { getPublicCourseByRef, isMarketplaceOpen } from "@/lib/data/server/public-course";
import { buildPageMetadata } from "@/lib/seo/page-metadata";
import { getServerTranslation } from "@/lib/i18n/server";

export async function generateMetadata() {
  const { t } = await getServerTranslation();
  return buildPageMetadata({
    title: t("home.metadata.title"),
    description: t("home.metadata.description"),
    path: "/",
  });
}

// O curso real que a home mostra enquanto a vitrine está fechada: o do
// fundador. ponytail: id fixo; se esse curso sair do ar, trocar aqui (ou ler
// o curso publicado mais recente, se a troca virar rotina).
const SHOWCASE_COURSE_ID = "1a280dc6-acce-4f1f-9e95-56df095131ae";
const SHOWCASE_COURSE_PATH = `/courses/${SHOWCASE_COURSE_ID}`;

export default async function Home() {
  // Vitrine fechada (menos de 12 cursos de 5 professores): a faixa "The
  // marketplace" dá lugar a um cartão que leva a UM curso real. O menu é o
  // mesmo das outras páginas e esconde "Courses" pela mesma regra (layout).
  const marketplaceOpen = await isMarketplaceOpen();
  const { t } = await getServerTranslation();
  // A capa de verdade do curso, a mesma da página dele: a home quase não tinha
  // imagem. Leitura que falha, curso fora do ar ou sem capa: o cartão de texto
  // de sempre, sem quadro vazio no lugar da foto.
  const showcase = marketplaceOpen ? null : await getPublicCourseByRef(SHOWCASE_COURSE_ID);
  const cover = showcase?.coverImageUrl ? { src: showcase.coverImageUrl, alt: showcase.title } : null;

  const courseCopy = (
    <span>
      <span className="block text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
        {t("home.realCourse.kicker")}
      </span>
      <span className="display-title mt-2 block text-2xl text-[var(--color-primary)] sm:text-3xl">
        {t("home.realCourse.title")}
      </span>
      <span className="mt-2 block max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
        {t("home.realCourse.body")}
      </span>
    </span>
  );
  const courseCta = (
    <span className="inline-flex shrink-0 items-center gap-2 text-sm font-semibold text-[var(--color-primary)]">
      {t("home.realCourse.cta")}
      <ArrowRight aria-hidden="true" size={16} strokeWidth={2} className="transition-transform group-hover:translate-x-0.5" />
    </span>
  );

  return (
    <div className="page-shell home-scroll">
      {/* .home-scroll liga a coreografia de rolagem (globals.css, "Home:
          coreografia de rolagem"); o fio abaixo é a barra de leitura. */}
      <div aria-hidden="true" className="home-scroll-progress" />
      <SiteNav />
      {/* Um <main> por página, alvo do "Skip to content" da barra. */}
      <main id="conteudo">
        <MarketingHero />
        <section id="how-it-works" className="home-how scroll-mt-28">
          <HowItWorksStrip />
        </section>
        {marketplaceOpen ? (
          <section id="courses" className="scroll-mt-28">
            <FeaturedCourses />
          </section>
        ) : (
          <section id="real-course" className="home-feature mx-auto w-full max-w-7xl px-5 sm:px-8">
            {cover ? (
              // Celular: capa em cima (16:9, largura toda) e o texto embaixo.
              // Do md para cima: capa à esquerda (45%) e o texto centrado à
              // direita; a capa estica até a altura do texto (object-cover).
              // O zoom lento no mouse é o da foto dos cartões da vitrine
              // (.marketplace-card__media img: 500ms, mesma curva, 1.045).
              <Link
                href={SHOWCASE_COURSE_PATH}
                className="group flex flex-col overflow-hidden rounded-lg border fine-rule bg-white shadow-[var(--shadow-soft)] transition hover:border-[var(--color-primary)] md:flex-row"
              >
                <span className="relative block aspect-[16/9] overflow-hidden md:w-[45%] md:shrink-0">
                  <Image
                    src={cover.src}
                    alt={cover.alt}
                    fill
                    sizes="(min-width: 1280px) 548px, (min-width: 768px) 45vw, 100vw"
                    className="object-cover transition-transform duration-500 ease-[cubic-bezier(0.2,0.6,0.2,1)] motion-safe:group-hover:scale-[1.045]"
                  />
                </span>
                <span className="flex flex-col justify-center gap-4 p-6 sm:p-8 lg:p-10">
                  {courseCopy}
                  {courseCta}
                </span>
              </Link>
            ) : (
              <Link
                href={SHOWCASE_COURSE_PATH}
                className="group flex flex-col gap-3 rounded-lg border fine-rule bg-white p-6 shadow-[var(--shadow-soft)] transition hover:border-[var(--color-primary)] sm:flex-row sm:items-center sm:justify-between sm:p-8"
              >
                {courseCopy}
                {courseCta}
              </Link>
            )}
          </section>
        )}
        <section id="capabilities" className="scroll-mt-28">
          <CapabilitiesGrid />
        </section>
        <section id="promise" className="scroll-mt-28">
          <PromisePreviewBand />
        </section>
        <section id="for-creators" className="scroll-mt-28">
          <ForCreatorsBand />
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
