// Public www copy: no earnings claims on /pricing, no psychologist framing on
// the home/footer/for-creators, and the one-time fee plus payout countries
// disclosed on /for-creators and /fees-and-payouts exactly as the teacher terms
// state them (legalPages.teacherTerms.text5 and text22-23).
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import PricingPage from "@/app/pricing/page";
import CreatorsPage, { generateMetadata as creatorsMetadata } from "@/app/for-creators/page";
import FeesPage from "@/app/fees-and-payouts/page";
import en from "@/data/i18n/en.json";
import es from "@/data/i18n/es.json";
import { plans } from "@/data/plans";

const state = vi.hoisted(() => ({ locale: "en" }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: state.locale }) }) }));
vi.mock("@/components/site/site-nav", () => ({ SiteNav: () => null }));
vi.mock("@/components/site/site-footer", () => ({ SiteFooter: () => null }));
afterEach(() => {
  cleanup();
  state.locale = "en";
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
