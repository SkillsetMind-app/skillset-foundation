// Public www copy: no earnings claims on /pricing, no psychologist framing on
// the home/footer/for-creators, and the one-time fee plus payout countries
// disclosed on /for-creators and /fees-and-payouts exactly as the teacher terms
// state them (legalPages.teacherTerms.text5 and text22-23).
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import PricingPage, { generateMetadata as pricingMetadata } from "@/app/pricing/page";
import CreatorsPage, { generateMetadata as creatorsMetadata } from "@/app/for-creators/page";
import FeesPage, { generateMetadata as feesMetadata } from "@/app/fees-and-payouts/page";
import HelpPage, { generateMetadata as helpMetadata } from "@/app/help/page";
import { generateMetadata as homeMetadata } from "@/app/page";
import { I18nProvider } from "@/components/i18n/i18n-provider";
import { CapabilitiesGrid } from "@/components/site/capabilities-grid";
import { ForCreatorsBand } from "@/components/site/for-creators-band";
import { HowItWorksStrip } from "@/components/site/how-it-works-strip";
import { MarketingHero } from "@/components/site/marketing-hero";
import { PromisePreviewBand } from "@/components/site/promise-preview-band";
import { helpFaqCategories } from "@/data/help-faq";
import en from "@/data/i18n/en.json";
import es from "@/data/i18n/es.json";
import { plans } from "@/data/plans";

const state = vi.hoisted(() => ({ locale: "en", fee: true }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: state.locale }) }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/site/site-nav", () => ({ SiteNav: () => null }));
vi.mock("@/components/site/site-footer", () => ({ SiteFooter: () => null }));
vi.mock("@/lib/assistant/config", () => ({ isAssistantEnabled: true }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ refreshUser: vi.fn(), status: "unauthenticated", user: null, signOut: vi.fn() }),
}));
// The one switch every public page reads to decide whether the fee exists.
vi.mock("@/data/plans", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/data/plans")>()),
  isActivationFeeConfigured: () => state.fee,
}));
afterEach(() => {
  cleanup();
  state.locale = "en";
  state.fee = true;
});

const incomeClaims =
  /\$3,500|\$11,000|\$400|\$380|Worth it from|Conviene a partir de|earning around|creators earning|ingresan|break-even|punto(s)? de equilibrio/i;

const dictionaries = [["en", en], ["es", es]] as const;

describe("public pricing makes no earnings claims", () => {
  it.each(["en", "es"])("the %s /pricing page shows fees, never income bands or break-even points", async (locale) => {
    state.locale = locale;
    const { container } = render(await PricingPage());
    expect(container.textContent).not.toMatch(incomeClaims);
    // The fee facts stay: 10% on Free and the $100 sample sale.
    expect(container.textContent).toContain("10%");
    expect(container.textContent).toContain("$100");
  });

  it.each(dictionaries)("the %s dictionary drops the break-even keys and income-band audiences", (_locale, dict) => {
    expect(dict.publicPages.pricing).not.toHaveProperty("worth_it_from");
    expect(dict.publicPages.pricing).not.toHaveProperty("mo_in_sales");
    for (const plan of Object.values(dict.publicPages.plans)) expect(plan.audience).not.toMatch(/\$/);
    expect(dict.publicPages.fees.full_plan_comparison_sample_breakdowns_and).not.toMatch(incomeClaims);
    expect(JSON.stringify(dict.publicPages.helpFaq)).not.toMatch(incomeClaims);
  });

  it("the plan data behind the pricing page and the assistant carries no income band", () => {
    for (const plan of plans) {
      expect(plan).not.toHaveProperty("breakEvenGmvUsd");
      expect(plan.audience).not.toMatch(/\$/);
    }
  });
});

describe("www positioning", () => {
  it.each(dictionaries)("the %s home, footer and /for-creators copy speaks to coaches, facilitators and mentors", (_locale, dict) => {
    expect(JSON.stringify([dict.home, dict.footer, dict.publicPages.creators])).not.toMatch(/psycholog|psicólog/i);
    expect(dict.home.hero.sub).toMatch(
      /^(For coaches, facilitators and mentors who already teach live|Para coaches, facilitadores y mentores que ya enseñan en vivo)/,
    );
  });
});

describe("creator fee disclosure", () => {
  const expected = {
    en: ["US$25", "activation checkout yourself", "once per creator account", "only while SkillsetMind requires activation", "must be approved before you can pay", "United States", "Canada", "United Kingdom", "Switzerland", "European Union", "Liechtenstein", "Norway", "Brazil"],
    es: ["US$25", "pago de activación en el estudio", "una sola vez por cuenta de creador", "mientras SkillsetMind exija la activación", "debe estar aprobada antes de que puedas pagar", "Estados Unidos", "Canadá", "Reino Unido", "Suiza", "Unión Europea", "Liechtenstein", "Noruega", "Brasil"],
  } as const;

  it.each([
    ["en", "/for-creators", CreatorsPage],
    ["es", "/for-creators", CreatorsPage],
    ["en", "/fees-and-payouts", FeesPage],
    ["es", "/fees-and-payouts", FeesPage],
  ] as const)("%s %s states the one-time activation fee and the payout countries", async (locale, _path, Page) => {
    state.locale = locale;
    const { container } = render(await Page());
    for (const text of expected[locale]) expect(container.textContent).toContain(text);
  });

  // Production gates /teach behind the fee (ActivationGate), so the page must
  // not promise drafting before it, nor sell the Free plan as "start free".
  it.each(["en", "es"])("%s /for-creators never promises drafting before activation or a free start", async (locale) => {
    state.locale = locale;
    const { container } = render(await CreatorsPage());
    const { description } = await creatorsMetadata();
    for (const text of [container.textContent, String(description)]) {
      expect(text).not.toMatch(/draft courses immediately|preparar cursos de inmediato|Start free|Empieza gratis/i);
    }
    expect(container.textContent).toMatch(/no monthly fee|sin mensualidad/);
  });
});

// One guard over every public entry page. Production truth it defends:
// /teach sits behind ActivationGate, so nobody drafts before the one-time fee;
// where verification is required it is approved before paying; publishing
// then passes launch checks; the Free plan has no monthly fee and takes 10%.
describe("public copy guard: home, /pricing, /fees-and-payouts, /for-creators, /help", () => {
  const falseClaims: ReadonlyArray<readonly [string, RegExp]> = [
    ["an earnings claim", incomeClaims],
    ["psychologist framing", /psycholog|psicólog/i],
    [
      "publishing or selling immediately",
      /publish[^.]{0,100}immediately|immediately[^.]{0,20}(publish|sell)|publica[^.]{0,100}de inmediato|de inmediato[^.]{0,20}(publica|vend)/i,
    ],
    [
      "drafting before verification or activation",
      /before (professional )?verification is complete|draft courses immediately|antes de completar la verificación|preparar cursos de inmediato/i,
    ],
    // The Free plan still charges the one-time activation, so "you only pay when you sell" is false.
    ["paying only when you sell", /only pay when you sell|solo pagas cuando vendes/i],
    [
      "a free start",
      /\bstart(ing)? (teaching )?free\b|get started free|teach(ing)? free|free to start|free, takes minutes|empieza (a enseñar )?gratis|enseñar gratis|gratis para empezar|es gratis y toma/i,
    ],
  ];

  function expectNoFalseClaim(where: string, text: string) {
    for (const [claim, pattern] of falseClaims) {
      expect(text, `${where} carries ${claim}`).not.toMatch(pattern);
    }
  }

  const wrap = (locale: string, node: ReactNode) => <I18nProvider initialLocale={locale as "en" | "es"}>{node}</I18nProvider>;

  async function home() {
    return (
      <>
        {await MarketingHero()}
        {await HowItWorksStrip()}
        {await CapabilitiesGrid()}
        {await PromisePreviewBand()}
        {await ForCreatorsBand()}
      </>
    );
  }

  const pages = [
    ["home", home, homeMetadata],
    ["/pricing", PricingPage, pricingMetadata],
    ["/fees-and-payouts", FeesPage, feesMetadata],
    ["/for-creators", CreatorsPage, creatorsMetadata],
    ["/help", HelpPage, helpMetadata],
  ] as const;

  const cases = (["en", "es"] as const).flatMap((locale) =>
    [true, false].flatMap((fee) => pages.map(([path, Page, metadata]) => [locale, fee, path, Page, metadata] as const)),
  );

  it.each(cases)("%s (fee configured: %s) %s renders no false claim", async (locale, fee, path, Page, metadata) => {
    state.locale = locale;
    state.fee = fee;
    const { container } = render(wrap(locale, await Page()));
    const meta = await metadata();
    expectNoFalseClaim(`${locale} ${path}`, `${container.textContent} ${String(meta.title)} ${String(meta.description)}`);
  });

  it.each(dictionaries)("the %s copy behind those pages (nav, home, plans, fees, creators, help) carries no false claim", (locale, dict) => {
    const p = dict.publicPages;
    expectNoFalseClaim(`${locale} dictionary`, JSON.stringify([dict.nav, dict.home, dict.footer, p.pricing, p.plans, p.fees, p.creators, p.help, p.helpFaq]));
  });

  it("the English sources shared with the assistant carry no false claim", () => {
    expectNoFalseClaim("help-faq.ts", JSON.stringify(helpFaqCategories));
    expectNoFalseClaim("plans.ts", JSON.stringify(plans));
  });

  // The fee sentence tracks isActivationFeeConfigured(), exactly like /pricing.
  const feeSentence = /\$25(?!\d)|activation fee|one-time activation|pago único de activación|activación única|tarifa (única )?de activación|cuota de activación/i;
  const feePages = pages.filter(([path]) => path !== "/help");
  const feeCases = (["en", "es"] as const).flatMap((locale) =>
    [true, false].flatMap((fee) => feePages.map(([path, Page]) => [locale, fee, path, Page] as const)),
  );

  it.each(feeCases)("%s (fee configured: %s) %s shows the fee sentence only when the fee is configured", async (locale, fee, path, Page) => {
    state.locale = locale;
    state.fee = fee;
    const { container } = render(wrap(locale, await Page()));
    if (fee) expect(container.textContent).toMatch(feeSentence);
    else expect(container.textContent).not.toMatch(feeSentence);
  });
});

// Production order: free signup, then professional verification where required,
// then the one-time activation while it is required, then drafting, then
// publishing after launch checks. Verification is not universal.
describe("creator path order and conditions", () => {
  const whereRequired = /where required|cuando se requiere/i;
  const whileActivation = /while activation is required|mientras se exija la activación/i;
  const at = (dict: object, path: string) => path.split(".").reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], dict);

  // Every key here is rendered: the home strips, /teach, /for-creators, /help,
  // the footer, /trust, the instructor directory and profile, onboarding, the
  // create-course start and the course builder.
  it.each(dictionaries)("the %s lines that describe verification say it applies where required", (_locale, dict) => {
    for (const path of [
      "home.hero.trust1Desc",
      "home.how.step1Activation",
      "home.how.step3Desc",
      "home.marketplace.sub",
      "footer.tagline",
      "teach.page.description",
      "publicPages.creators.professional_verification_up_front_then_automated",
      "publicPages.creators.creators_can_draft_after_verification",
      "publicPages.helpFaq.course-creation.items.4.a",
      "publicPages.trust.skillsetmind_verifies_professional_eligibility_before_publication",
      "publicPages.directory.course_pages_still_show_verified_instructor",
      "publicPages.profile.only_shows_published_courses_from_verified",
      "onboarding.pathTeachDesc",
      "courseCreation.privateDraft",
      "creatorPanel.products.description",
      "creatorEditor.builder.publish.help",
    ]) {
      expect(at(dict, path), path).toMatch(whereRequired);
    }
    expect(at(dict, "creatorEditor.builder.publish.help")).not.toMatch(/approved creator|creador aprobado/i);
  });

  it.each(dictionaries)("the %s activation lines say the activation applies while it is required", (_locale, dict) => {
    for (const path of ["home.how.step1Activation", "teach.page.description"]) {
      expect(at(dict, path), path).toMatch(whileActivation);
    }
  });

  it("the help FAQ answer shared with the assistant says verification applies where required", () => {
    const answer = helpFaqCategories.flatMap((category) => category.items).find((item) => item.id === "course-publishing")?.a;
    expect(answer).toMatch(whereRequired);
    expect(answer).not.toMatch(/Approved creators/);
  });

  it.each(dictionaries)("the %s /teach description puts verification before paying and activation before drafting", (_locale, dict) => {
    expect(dict.teach.page.description).toMatch(/before you can pay|antes de que puedas pagar/);
    expect(dict.teach.page.description).not.toMatch(/while SkillsetMind verifies|mientras SkillsetMind verifica/i);
  });

  // Connect Stripe answers 402 until the activation is paid (assertCreatorActivated).
  it.each(["en", "es"])("%s home step 1 (fee configured) puts the activation before Stripe Express", async (locale) => {
    state.locale = locale;
    const text = String(render(await HowItWorksStrip()).container.textContent);
    expect(text).toContain("US$25");
    expect(text.indexOf("US$25")).toBeLessThan(text.indexOf("Stripe Express"));
  });

  it.each([
    ["en", en],
    ["es", es],
  ] as const)("%s home step 1 names the activation only while the fee is configured", async (locale, dict) => {
    state.locale = locale;
    const step = dict.home.how.step1Activation.replace("{amount}", "25");
    expect(render(await HowItWorksStrip()).container.textContent).toContain(step);
    cleanup();
    state.fee = false;
    expect(render(await HowItWorksStrip()).container.textContent).not.toContain(step);
  });

  it.each([
    ["en", en],
    ["es", es],
  ] as const)("%s /for-creators heading and no-fee paragraph carry their conditions", async (locale, dict) => {
    state.locale = locale;
    const withFee = render(await CreatorsPage()).container.textContent;
    expect(withFee).toContain(dict.publicPages.creators.start_as_a_creator_publish_after);
    expect(dict.publicPages.creators.start_as_a_creator_publish_after).toMatch(whileActivation);
    cleanup();
    state.fee = false;
    const withoutFee = render(await CreatorsPage()).container.textContent;
    expect(withoutFee).toContain(dict.publicPages.creators.creators_can_draft_after_verification);
    expect(dict.publicPages.creators.creators_can_draft_after_verification).toMatch(
      /^(Drafting courses in the studio is open\. Publishing needs|La preparación de cursos en el estudio está abierta\. Para publicar necesitas)/,
    );
  });
});
