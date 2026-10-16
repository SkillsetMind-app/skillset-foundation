import { CapabilitiesGrid } from "@/components/site/capabilities-grid";
import { FeaturedCourses } from "@/components/site/featured-courses";
import { ForCreatorsBand } from "@/components/site/for-creators-band";
import { HowItWorksStrip } from "@/components/site/how-it-works-strip";
import { MarketingHero } from "@/components/site/marketing-hero";
import { PromisePreviewBand } from "@/components/site/promise-preview-band";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteNav } from "@/components/site/site-nav";
import { hasRealPublishedCourse } from "@/lib/data/server/public-course";
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

// Single-page landing: header items scroll to these sections, listed in the
// order the sections appear below so the menu reads as a map of the page.
// "Pricing" stays a real route (no fabricated pricing section on the home).
// ponytail: "Capabilities" has no header entry — six links plus the language
// chip no longer fit a 1024px header; the section still sits between courses
// and the promise.
const landingNav = [
  { labelKey: "home.nav.howItWorks", anchorId: "how-it-works" },
  { labelKey: "home.nav.courses", anchorId: "courses" },
  { labelKey: "home.nav.promise", anchorId: "promise" },
  { labelKey: "home.nav.forCreators", anchorId: "for-creators" },
  { labelKey: "home.nav.pricing", href: "/pricing" },
] as const;

export default async function Home() {
  // Loja vazia: a faixa de cursos dizia "o marketplace abre em breve" no meio
  // da home. Sem curso real publicado, some a seção e o item do menu que rola
  // até ela. Leitura anônima, em cache de 5 min e com prazo curto; falha conta
  // como vazio — a home nunca quebra por isso.
  const hasRealCourses = await hasRealPublishedCourse();
  const nav = hasRealCourses
    ? landingNav
    : landingNav.filter((item) => !("anchorId" in item && item.anchorId === "courses"));

  return (
    <div className="page-shell">
      <SiteNav landingNav={nav} />
      {/* Um <main> por página, alvo do "Skip to content" da barra. */}
      <main id="conteudo">
        <MarketingHero />
        <section id="how-it-works" className="scroll-mt-28">
          <HowItWorksStrip />
        </section>
        {hasRealCourses ? (
          <section id="courses" className="scroll-mt-28">
            <FeaturedCourses />
          </section>
        ) : null}
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
