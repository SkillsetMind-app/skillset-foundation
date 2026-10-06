// Public www copy: no earnings claims on /pricing, psychologists named on the
// home only (decision of 2026-09-25; the footer and /for-creators still do not),
// payout countries disclosed on /for-creators and /fees-and-payouts exactly as
// the teacher terms state them (legalPages.teacherTerms.text5), and no
// activation fee anywhere: the plans are the whole price.
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
import { buildAssistantKnowledge } from "@/lib/assistant/knowledge";

const state = vi.hoisted(() => ({ locale: "en" }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: state.locale }) }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/site/site-nav", () => ({ SiteNav: () => null }));
vi.mock("@/components/site/site-footer", () => ({ SiteFooter: () => null }));
vi.mock("@/lib/assistant/config", () => ({ isAssistantEnabled: true }));
vi.mock("@/components/auth/auth-provider", () => ({
  useAuth: () => ({ refreshUser: vi.fn(), status: "unauthenticated", user: null, signOut: vi.fn() }),
}));
afterEach(() => {
  cleanup();
  state.locale = "en";
});

const incomeClaims =
  /\$3,500|\$11,000|\$400|\$380|Worth it from|Conviene a partir de|earning around|creators earning|ingresan|break-even|punto(s)? de equilibrio/i;

// Any mention of a fee to activate or switch on a creator storefront, EN and ES:
// the words, a US${amount} placeholder next to "fee", and an "active storefront"
// that something else has to unlock.
const activationFee =
  /activation fee|activat\w* (your |the )?storefront|storefront activation|activation (charge|cost|payment)|one-time (US\$\S+ )?(activation|fee)|(setup|publishing) fee|US\$\s?\{amount\}[^"]{0,80}\bfee|\bfee\b[^"]{0,80}US\$\s?\{amount\}|US\$\s?25\b|\$25(?!\d)|active storefront|tarifa (única )?de activación|tarifa única|(cuota|cargo|costo|coste|pago) (único )?de activación|activación única|activación de (la|tu) tienda|activ\w* (de )?tu tienda|activar tienda|tienda activa/i;

const dictionaries = [["en", en], ["es", es]] as const;

describe("public pricing makes no earnings claims", () => {
  it.each(["en", "es"])("the %s /pricing page shows fees, never income bands or break-even points", async (locale) => {
    state.locale = locale;
    const { container } = render(await PricingPage());
    expect(container.textContent).not.toMatch(incomeClaims);
    // The fee facts stay: 4.9% on Starter, 0% on Pro and the $100 sample sale.
    expect(container.textContent).toContain("4.9%");
    expect(container.textContent).toContain("0%");
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
  it.each(dictionaries)("the %s home, footer and /for-creators copy names its audience", (_locale, dict) => {
    expect(JSON.stringify([dict.footer, dict.publicPages.creators])).not.toMatch(/psycholog|psicólog/i);
    expect(dict.home.hero.sub).toMatch(
      /^(For psychologists and personal-development professionals who already teach live|Para psicólogos y profesionales del desarrollo personal que ya enseñan en vivo)/,
    );
  });
});

// Plans differ by commission, a few paid extras, and the Free plan's daily caps
// (video uploads, advisor, manual access). Published products, active students,
// video storage and team seats are not enforced, so no public line may sell
// them as limits, and "same features, only the commission changes" is false.
describe("plan copy states only rules the product applies", () => {
  const unenforcedLimits = /published products|active students|students, video storage|team seats|within its limits|already applied|productos publicados|alumnos activos|alumnos, almacenamiento|miembros del equipo|dentro de sus límites|ya se aplicaban/i;
  const sameFeatures = /same features|same toolset|no locked features|every feature|only changes the commission|mismas funciones|mismo conjunto|sin funciones bloqueadas|todas las funciones|solo cambia la comisión/i;

  it.each(dictionaries)("the %s Promise, changelog and plan lines claim no unenforced limit and no feature parity", (_locale, dict) => {
    const copy = JSON.stringify([dict.home.promise, dict.home.capabilities, dict.publicPages.promise, dict.promiseChangelog, dict.publicPages.pricing, dict.publicPages.fees, dict.accountPlansPage]);
    expect(copy).not.toMatch(unenforcedLimits);
    expect(copy).not.toMatch(sameFeatures);
  });

  it.each(dictionaries)("the %s Promise 02 says every plan sells and names the Free daily limits", (_locale, dict) => {
    expect(dict.publicPages.promise.no_plan_ever_blocks_you_from).toMatch(/^(Every plan can publish and sell|Todos los planes pueden publicar y vender)$/);
    expect(dict.publicPages.promise.the_selling_engine_is_on_every).toMatch(/daily limits|límites diarios/);
    expect(dict.publicPages.promise.a_creator_on_free_runs_a).toMatch(/commission|comisión/);
  });

  // Promise 01 protects the rate; it must not assume the creator will sell.
  it.each(dictionaries)("the %s Promise 01 does not assume the creator will sell", (_locale, dict) => {
    expect(dict.publicPages.promise.if_a_creator_joins_on_free).not.toMatch(/sell|selling|vender|venta/i);
  });

  // The offer is Starter and Pro, each with a trial. The internal free tier and
  // the retired Plus are not something the assistant may sell.
  it("the assistant's plan summary names the trial, the two plans and no feature parity", () => {
    const knowledge = buildAssistantKnowledge();
    expect(knowledge).not.toMatch(sameFeatures);
    expect(knowledge).not.toMatch(unenforcedLimits);
    expect(knowledge).toMatch(/14-day free trial/);
    expect(knowledge).not.toMatch(/Free plan|- Free:|Plus/);
  });
});

describe("creator payout-country disclosure", () => {
  const expected = {
    en: ["United States", "Canada", "United Kingdom", "Switzerland", "European Union", "Liechtenstein", "Norway", "Brazil"],
    es: ["Estados Unidos", "Canadá", "Reino Unido", "Suiza", "Unión Europea", "Liechtenstein", "Noruega", "Brasil"],
  } as const;

  it.each([
    ["en", "/for-creators", CreatorsPage],
    ["es", "/for-creators", CreatorsPage],
    ["en", "/fees-and-payouts", FeesPage],
    ["es", "/fees-and-payouts", FeesPage],
  ] as const)("%s %s states the payout countries", async (locale, _path, Page) => {
    state.locale = locale;
    const { container } = render(await Page());
    for (const text of expected[locale]) expect(container.textContent).toContain(text);
  });

  // "Immediately" and "start free" oversell: publishing needs the launch checks
  // and, where required, verification. Since 2026-10-06 no public plan is
  // free of a monthly fee: the page offers the 14-day trial instead.
  it.each(["en", "es"])("%s /for-creators never promises immediate drafting or a free start", async (locale) => {
    state.locale = locale;
    const { container } = render(await CreatorsPage());
    const { description } = await creatorsMetadata();
    for (const text of [container.textContent, String(description)]) {
      expect(text).not.toMatch(/draft courses immediately|preparar cursos de inmediato|Start free|Empieza gratis/i);
    }
    expect(container.textContent).not.toMatch(/no monthly fee|sin mensualidad/);
    expect(container.textContent).toMatch(/14-day free trial|prueba gratis de 14 días/);
  });
});

// One guard over every public entry page. Production truth it defends:
// drafting is open; where verification is required it is approved before
// publishing; publishing passes launch checks; Starter and Pro each start with
// a 14-day free trial; there is no activation fee.
describe("public copy guard: home, /pricing, /fees-and-payouts, /for-creators, /help", () => {
  const falseClaims: ReadonlyArray<readonly [string, RegExp]> = [
    ["an earnings claim", incomeClaims],
    [
      "publishing or selling immediately",
      /publish[^.]{0,100}immediately|immediately[^.]{0,20}(publish|sell)|publica[^.]{0,100}de inmediato|de inmediato[^.]{0,20}(publica|vend)/i,
    ],
    [
      "drafting before verification or activation",
      /before (professional )?verification is complete|draft courses immediately|antes de completar la verificación|preparar cursos de inmediato/i,
    ],
    // Paid plans bill monthly whether or not you sell.
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

  // Since 2026-09-25 the home names psychologists as part of its audience (a
  // decision of the owner). Every other public entry page still does not.
  const psychologistFraming = /psycholog|psicólog/i;

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
    pages.map(([path, Page, metadata]) => [locale, path, Page, metadata] as const),
  );

  it.each(cases)("%s %s renders no false claim and no activation fee", async (locale, path, Page, metadata) => {
    state.locale = locale;
    const { container } = render(wrap(locale, await Page()));
    const meta = await metadata();
    const text = `${container.textContent} ${String(meta.title)} ${String(meta.description)}`;
    expectNoFalseClaim(`${locale} ${path}`, text);
    expect(text, `${locale} ${path} mentions an activation fee`).not.toMatch(activationFee);
    if (path !== "home") expect(text, `${locale} ${path} carries psychologist framing`).not.toMatch(psychologistFraming);
  });

  it.each(dictionaries)("the %s copy behind those pages (nav, home, plans, fees, creators, help) carries no false claim", (locale, dict) => {
    const p = dict.publicPages;
    expectNoFalseClaim(`${locale} dictionary`, JSON.stringify([dict.nav, dict.home, dict.footer, p.pricing, p.plans, p.fees, p.creators, p.help, p.helpFaq]));
    expect(JSON.stringify([dict.nav, dict.footer, p.pricing, p.plans, p.fees, p.creators, p.help, p.helpFaq])).not.toMatch(psychologistFraming);
  });

  it("the English sources shared with the assistant carry no false claim", () => {
    expectNoFalseClaim("help-faq.ts", JSON.stringify(helpFaqCategories));
    expectNoFalseClaim("plans.ts", JSON.stringify(plans));
    expect(JSON.stringify([helpFaqCategories, plans])).not.toMatch(psychologistFraming);
  });

  // No string a visitor, invitee or creator reads with the activation flag off
  // may mention an activation fee: the public namespaces, the legal pages, sign
  // up, onboarding, invitations, the studio (teach.*), and the English sources
  // the assistant quotes. activationCheckout.* and the other dormant fee strings
  // live in namespaces this guard does not read, and only render while
  // platform_settings.require_activation_fee is on.
  const scanned = ["nav", "footer", "home", "siteMetadata", "publicCourses", "publicPages", "legalPages", "promiseChangelog", "platformInvites", "auth", "onboarding", "teach"] as const;
  // Dormant keys inside scanned namespaces, each unreachable with the flag off:
  const dormant = new Set([
    // Ops-only invite manager and role manager (admin, AAL2): the waiver switch
    // for the dormant fee. The invitee's screen no longer shows any of them.
    ...["waive", "require", "waived", "notWaived", "waiveConfirm", "requireConfirm", "waiverSaved", "requireSaved", "waiverError"].map((key) => `platformInvites.${key}`),
    // The 402 claim_custom_domain raises only while the gate holds a creator back.
    "teach.customDomains.errors.activation",
  ]);
  const strings = (node: unknown, path: string): Array<[string, string]> => typeof node === "string"
    ? [[path, node]]
    : Object.entries(node as Record<string, unknown>).flatMap(([key, value]) => strings(value, `${path}.${key}`));

  it.each(dictionaries)("no %s string shown with the flag off mentions an activation fee or activating a storefront", (_locale, dict) => {
    const offenders = scanned
      .flatMap((namespace) => strings(dict[namespace], namespace))
      .filter(([path, value]) => !dormant.has(path) && activationFee.test(value))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
    expect(JSON.stringify([helpFaqCategories, plans])).not.toMatch(activationFee);
  });

  // The exclusions stay honest: each dormant key still names the fee in at least
  // one language, so a key that stops needing the exemption leaves the list.
  it("every dormant exclusion still names the fee", () => {
    for (const path of dormant) {
      const values = dictionaries.map(([, dict]) => path.split(".").reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], dict));
      expect(values.some((value) => typeof value === "string" && activationFee.test(value)), path).toBe(true);
    }
  });
});

// Production order: free signup, drafting and Stripe; professional verification
// where required; launch checks; publish. Verification is not universal.
describe("creator path order and conditions", () => {
  const whereRequired = /where required|cuando se requiere/i;
  const at = (dict: object, path: string) => path.split(".").reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], dict);

  // Every key here is rendered: the home strips, /teach, /for-creators, /help,
  // the footer, /trust, the instructor directory, onboarding, the
  // create-course start and the course builder.
  it.each(dictionaries)("the %s lines that describe verification say it applies where required", (_locale, dict) => {
    for (const path of [
      "home.hero.trust1Desc",
      "home.how.step3Desc",
      "home.marketplace.sub",
      "footer.tagline",
      "teach.page.description",
      "publicPages.creators.professional_verification_up_front_then_automated",
      "publicPages.creators.creators_can_draft_after_verification",
      "publicPages.helpFaq.course-creation.items.4.a",
      "publicPages.trust.skillsetmind_verifies_professional_eligibility_before_publication",
      "publicPages.directory.course_pages_still_show_verified_instructor",
      "onboarding.pathTeachDesc",
      "courseCreation.privateDraft",
      "creatorPanel.products.description",
      "creatorEditor.builder.publish.help",
    ]) {
      expect(at(dict, path), path).toMatch(whereRequired);
    }
    expect(at(dict, "creatorEditor.builder.publish.help")).not.toMatch(/approved creator|creador aprobado/i);
  });

  // Decisão de 2026-10-06: todo professor com o cadastro completo tem perfil
  // público e só o selo diz quem foi verificado. Nenhuma frase pública chama
  // os instrutores de verificados, revisados ou avaliados em bloco — no
  // singular ou no plural, nas duas ordens, em EN e ES. Ficam de fora o nome
  // do selo entre aspas e a frase com a ressalva "where required".
  describe("no group verification claim", () => {
    const enNoun = String.raw`(?:instructor|teacher|creator|professional|educator|expert)s?`;
    const enAdj = String.raw`(?:verified|vetted|reviewed)`;
    const esNoun = String.raw`(?:instructor(?:a|es|as)?|profesor(?:a|es|as)?|creador(?:a|es|as)?|educador(?:a|es|as)?|profesional(?:es)?|expert[oa]s?|docentes?)`;
    const esAdj = String.raw`(?:verificad|evaluad|revisad)[oa]s?`;
    const groupClaim = new RegExp([
      // "verified experts", "reviewed creator profiles" (não "reviewed professional evidence")
      String.raw`\b${enAdj}\s+${enNoun}\b(?![-\s]+(?:evidence|badge|license|credentials?)\b)`,
      // "instructors are vetted", "every teacher is verified"
      String.raw`\b${enNoun}\s+(?:(?:are|is|were|was|get|gets|been|being|all)\s+)*${enAdj}\b`,
      String.raw`\b${esAdj}\s+${esNoun}\b`,
      // "expertos evaluados", "creadores son revisados" (não "evidencia profesional revisada")
      String.raw`(?<!(?:evidencia|licencia)\s)\b${esNoun}\s+(?:(?:son|es|fueron|fue|están|está)\s+)?${esAdj}\b`,
    ].join("|"), "i");
    const badgeName = /["“«]\s*(?:verified professional|profesional verificad[oa])\s*["”»]/gi;
    const qualified = /where required|cuando se requiere/i;
    const claimsGroup = (text: string) => text.replace(badgeName, "").split(/(?<=[.!?;])\s+/)
      .some((sentence) => !qualified.test(sentence) && groupClaim.test(sentence));
    const strings = (node: unknown, path: string): Array<[string, string]> => typeof node === "string"
      ? [[path, node]]
      : node && typeof node === "object"
        ? Object.entries(node).flatMap(([key, value]) => strings(value, `${path}.${key}`))
        : [];

    it.each([
      "Courses by verified experts, ready to learn.",
      "Learn from reviewed experts.",
      "Every instructor is vetted by our team.",
      "Built around reviewed creator profiles.",
      "Our teachers are verified before they publish.",
      "Learn from a verified professional.",
      "Aprende de expertos evaluados.",
      "Cursos de instructores verificados.",
      "Los creadores son revisados por SkillsetMind.",
      "Clases de profesionales verificados.",
    ])("catches %s", (text) => {
      expect(claimsGroup(text)).toBe(true);
    });

    it.each([
      "Experts verified where required, no platform hold on your money, verifiable certificates.",
      "Where required, professionals are verified before they can publish.",
      "Expertos verificados cuando se requiere, sin retención de la plataforma sobre tu dinero.",
      "Every course is built by an independent professional, verified by SkillsetMind where required.",
      'Otherwise it is optional: a "Verified professional" badge means our team checked a license, or reviewed professional evidence, on the date shown.',
      "En los demás casos es opcional: el sello «Profesional verificado» indica que nuestro equipo comprobó una licencia, o revisó evidencia profesional.",
      'Meet the independent creators teaching on SkillsetMind. The "Verified professional" badge marks the ones our team has reviewed.',
      "Add the verified-professional badge to your profile.",
    ])("lets through %s", (text) => {
      expect(claimsGroup(text)).toBe(false);
    });

    it.each(dictionaries)("the %s public copy never calls instructors verified or reviewed as a group", (_locale, dict) => {
      const offenders = (["home", "footer", "publicPages", "publicCourses", "siteMetadata"] as const)
        .flatMap((namespace) => strings(dict[namespace], namespace))
        .filter(([, value]) => claimsGroup(value))
        .map(([path]) => path);
      expect(offenders).toEqual([]);
    });

    // O diretório não promete identidade conferida: "real" saiu das frases.
    it.each(dictionaries)("the %s /instructors copy makes no identity claim", (_locale, dict) => {
      const { instructors, directory } = dict.publicPages;
      for (const text of [
        instructors.meet_independent_creators_whose_public_profiles,
        directory.skillsetmind_only_lists_real_published_profiles,
        directory.this_instructor_has_published_their_profile,
      ]) {
        expect(text).not.toMatch(/\breal(?:es)?\b|published their profile|ha publicado su perfil/i);
      }
    });
  });

  it("the help FAQ answer shared with the assistant says verification applies where required", () => {
    const answer = helpFaqCategories.flatMap((category) => category.items).find((item) => item.id === "course-publishing")?.a;
    expect(answer).toMatch(whereRequired);
    expect(answer).not.toMatch(/Approved creators/);
  });

  it.each(dictionaries)("the %s /teach description opens drafting and asks for nothing to pay", (_locale, dict) => {
    expect(dict.teach.page.description).toMatch(/^(Drafting is open from the start\.|La preparación de cursos está abierta desde el principio\.)/);
    expect(dict.teach.page.description).not.toMatch(/pay|pagar|activation|activación/i);
    expect(dict.teach.page.description).not.toMatch(/while SkillsetMind verifies|mientras SkillsetMind verifica/i);
  });

  it.each([
    ["en", en],
    ["es", es],
  ] as const)("%s home step 1 and /for-creators describe the path with no fee", async (locale, dict) => {
    state.locale = locale;
    expect(render(await HowItWorksStrip()).container.textContent).toContain(dict.home.how.step1Desc);
    cleanup();
    const creators = render(await CreatorsPage()).container.textContent;
    expect(creators).toContain(dict.publicPages.creators.draft_then_publish);
    expect(creators).toContain(dict.publicPages.creators.creators_can_draft_after_verification);
    expect(dict.publicPages.creators.creators_can_draft_after_verification).toMatch(
      /^(Drafting courses in the studio is open\. Publishing needs|La preparación de cursos en el estudio está abierta\. Para publicar necesitas)/,
    );
  });
});
