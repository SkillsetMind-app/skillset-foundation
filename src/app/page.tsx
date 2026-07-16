import { CapabilitiesGrid } from "@/components/site/capabilities-grid";
import { FeaturedCourses } from "@/components/site/featured-courses";
import { ForCreatorsBand } from "@/components/site/for-creators-band";
import { HowItWorksStrip } from "@/components/site/how-it-works-strip";
import { MarketingHero } from "@/components/site/marketing-hero";
import { PromisePreviewBand } from "@/components/site/promise-preview-band";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteNav } from "@/components/site/site-nav";
import { buildPageMetadata } from "@/lib/seo/page-metadata";

export const metadata = buildPageMetadata({
  title: "Course platform for psychology & personal-development experts",
  description:
    "SkillsetMind is where verified psychologists, therapists, and personal-development professionals publish courses with private communities, live sessions, and verifiable certificates. We run checkout, classroom, and payouts. You teach.",
  path: "/",
});

// Single-page landing: header items scroll to these sections. "Pricing"
// stays a real route (no fabricated pricing section — DECISIONS D7).
const landingNav = [
  { labelKey: "home.nav.howItWorks", anchorId: "how-it-works" },
  { labelKey: "home.nav.capabilities", anchorId: "capabilities" },
  { labelKey: "home.nav.forCreators", anchorId: "for-creators" },
  { labelKey: "home.nav.promise", anchorId: "promise" },
  { labelKey: "home.nav.pricing", href: "/pricing" },
] as const;

export default function Home() {
  return (
    <div className="page-shell">
      <SiteNav landingNav={landingNav} />
      <MarketingHero />
      <section id="how-it-works" className="scroll-mt-28">
        <HowItWorksStrip />
      </section>
      <section id="courses" className="scroll-mt-28">
        <FeaturedCourses />
      </section>
      <section id="capabilities" className="scroll-mt-28">
        <CapabilitiesGrid />
      </section>
      <section id="promise" className="scroll-mt-28">
        <PromisePreviewBand />
      </section>
      <section id="for-creators" className="scroll-mt-28">
        <ForCreatorsBand />
      </section>
      <SiteFooter />
    </div>
  );
}
