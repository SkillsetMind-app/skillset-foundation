import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { CapabilitiesGrid } from "@/components/site/capabilities-grid";
import { FeaturedCourses } from "@/components/site/featured-courses";
import { ForCreatorsBand } from "@/components/site/for-creators-band";
import { HomeFactsBand } from "@/components/site/home-facts-band";
import { HomeFaq } from "@/components/site/home-faq";
import { HowItWorksStrip } from "@/components/site/how-it-works-strip";
import { MarketingHero } from "@/components/site/marketing-hero";
import { PromisePreviewBand } from "@/components/site/promise-preview-band";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteNav } from "@/components/site/site-nav";
import { getShowcaseCourseCover, isMarketplaceOpen } from "@/lib/data/server/public-course";
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
  // imagem. Leitura anônima em cache de 5 min e prazo de 1,5 s (a mesma da
  // checagem da vitrine). Leitura que falha ou passa do prazo, curso fora do
  // ar ou sem capa: o cartão de texto de sempre, sem quadro vazio no lugar.
  const showcase = marketplaceOpen ? null : await getShowcaseCourseCover(SHOWCASE_COURSE_ID);
  const cover = showcase?.coverImageUrl ? { src: showcase.coverImageUrl, alt: showcase.title } : null;

  const courseCopy = (
    <span>
      <span className="block text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-fg)]">
        {t("home.realCourse.kicker")}
      </span>
      <span className="display-title mt-2 block text-2xl text-[var(--color-primary)] sm:text-3xl">
        {t("home.realCourse.title")}
      </span>
      <span className="mt-2 block max-w-2xl text-[1.0625rem] leading-[1.6] text-[var(--color-ink)] md:text-lg">
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
        {/* Fatos que já são verdade (moedas, tarifa fixa, compromissos e o
            teste), logo abaixo do topo. Sem âncora: não é destino de menu. */}
        <HomeFactsBand />
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
              // Celular e tablet: capa em cima (16:9, largura toda) e o texto
              // embaixo. As duas colunas só começam no lg: entre 768 e 1023 o
              // texto ficava bem mais alto que a capa. Do lg para cima a capa
              // fica à esquerda (45%), com margem e cantos próprios, e capa e
              // texto ficam centrados na altura: a capa é sempre 16:9, nunca
              // estica nem corta para acompanhar o texto. O zoom lento no
              // mouse é o da foto da vitrine (.marketplace-card__media img:
              // 500ms, mesma curva, 1.045).
              <Link
                href={SHOWCASE_COURSE_PATH}
                className="group flex flex-col overflow-hidden rounded-lg border fine-rule bg-white shadow-[var(--shadow-soft)] transition hover:border-[var(--color-primary)] lg:flex-row lg:items-center"
              >
                <span className="relative block aspect-[16/9] overflow-hidden lg:m-6 lg:w-[45%] lg:shrink-0 lg:rounded-md">
                  <Image
                    src={cover.src}
                    alt={cover.alt}
                    fill
                    sizes="(min-width: 1280px) 548px, (min-width: 1024px) 45vw, 100vw"
                    className="object-cover transition-transform duration-500 ease-[cubic-bezier(0.2,0.6,0.2,1)] motion-safe:group-hover:scale-[1.045]"
                  />
                </span>
                <span className="flex flex-col justify-center gap-4 p-6 sm:p-8 lg:p-10 lg:pl-4">
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
        {/* Perguntas frequentes, com as respostas da central de ajuda. */}
        <section id="faq" className="scroll-mt-28">
          <HomeFaq />
        </section>
        <section id="for-creators" className="scroll-mt-28">
          <ForCreatorsBand />
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
