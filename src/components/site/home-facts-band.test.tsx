import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HomeFactsBand } from "@/components/site/home-facts-band";
import { PLAN_TRIAL_DAYS } from "@/data/plans";
import en from "@/data/i18n/en.json";
import es from "@/data/i18n/es.json";
import { supportedStripeCurrencies } from "@/lib/payments/currencies";

// Server component: the language comes from the cookie.
const state = vi.hoisted(() => ({ locale: "en" }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: state.locale }) }) }));

afterEach(() => {
  cleanup();
  state.locale = "en";
});

const dictionaries = [["en", en], ["es", es]] as const;

async function renderBand(locale: string) {
  state.locale = locale;
  const { container } = render(await HomeFactsBand());
  const pairs = [...container.querySelectorAll("dl > div")].map((item) => [
    item.querySelector("dt")?.textContent,
    item.querySelector("dd")?.textContent,
  ]);
  return { container, pairs };
}

describe("home facts band", () => {
  // Exactly the four chosen facts, in this order, each with its caption. The
  // trial caption continues the number, in lowercase ("14" + "day free
  // trial, card required"); the one on /for-creators has a capital "D" because there the
  // caption is all uppercase.
  it.each(dictionaries)("in %s shows only the four facts, with the dictionary captions", async (locale, dict) => {
    const { container, pairs } = await renderBand(locale);

    expect(pairs).toEqual([
      ["30", dict.home.facts.currencies],
      [dict.home.facts.feeLockMonths, dict.home.facts.feeLock],
      [dict.home.facts.commitmentsCount, dict.home.facts.commitments],
      ["14", dict.home.facts.trial],
    ]);
    // A real definition list: each fact is a <div> with a <dt> and a <dd>.
    expect(container.querySelectorAll("dl > div > dt")).toHaveLength(4);
    expect(container.querySelectorAll("dl > div > dd")).toHaveLength(4);
    expect(container.querySelectorAll("dl > :not(div)")).toHaveLength(0);
    // A fact is not a link: nothing here leads anywhere.
    expect(container.querySelector("a")).toBeNull();
  });

  // The left edge of the band is the same as the top's and the "How it works": the same
  // box (max-w-7xl with the padding inside it). Padding on the band, outside the
  // box, left the facts 32px to the left of the rest on wide screens.
  it("uses the same box as the neighboring sections, with the padding inside it", async () => {
    const { container } = await renderBand("en");
    const box = ["mx-auto", "w-full", "max-w-7xl", "px-5", "sm:px-8"];

    expect(container.querySelector("dl")).toHaveClass(...box);
    expect(container.querySelector("section")?.className).not.toMatch(/(?:^|\s)(?:\w+:)?px-/);
    for (const path of ["src/components/site/how-it-works-strip.tsx", "src/components/site/marketing-hero.tsx"]) {
      const source = readFileSync(join(process.cwd(), path), "utf8");
      expect(source, path).toMatch(/className="[^"]*\bmx-auto w-full max-w-7xl px-5 [^"]*\bsm:px-8\b/);
    }
  });

  it.each(dictionaries)("in %s the section has a name: a hidden title, read by the screen reader", async (locale, dict) => {
    const { container } = await renderBand(locale);

    const section = container.querySelector("section");
    const title = container.querySelector(`#${section?.getAttribute("aria-labelledby")}`);
    expect(title?.tagName).toBe("H2");
    expect(title).toHaveClass("sr-only");
    expect(title?.textContent).toBe(dict.home.facts.title);
  });

  // Each number is already written somewhere else on the site, with the same count.
  // If the product changes (a different number of currencies, a different trial length) or the
  // source sentence changes, this test breaks before the band lies.
  it.each(dictionaries)("in %s each number is the same as in the sentence the site already publishes", (locale, dict) => {
    const [currencies, months, commitments, days] = [
      String(supportedStripeCurrencies.length),
      dict.home.facts.feeLockMonths,
      dict.home.facts.commitmentsCount,
      String(PLAN_TRIAL_DAYS),
    ];
    const word = locale === "en"
      ? { currencies: "currencies", months: "months", six: /^Six commitments/ }
      : { currencies: "monedas", months: "meses", six: /^Seis compromisos/ };

    // 30 currencies: the home's features card and the top.
    expect(dict.home.capabilities.c4Desc).toContain(`${currencies} ${word.currencies}`);
    expect(dict.home.hero.trust2Desc).toContain(`${currencies} ${word.currencies}`);
    // 24 months: clause 01 of the Promise, on the home and on /promise.
    expect(dict.home.promise.clause1).toContain(`${months} ${word.months}`);
    expect(dict.publicPages.promise.fee_lock_for_24_months).toContain(`${months} ${word.months}`);
    // What stays locked is what Promise 01 locks, the commission and the per-sale
    // fee, and not the plan price (which can go up): the caption does not
    // mention the plan.
    const lock = dict.publicPages.promise.the_commission_rate_of_the_plan;
    if (locale === "en") {
      expect(lock).toMatch(new RegExp(`commission and the fixed per-sale fee .*locked for ${months} months`));
      expect(lock).toMatch(/even if SkillsetMind raises plan pricing later/);
      expect(dict.home.facts.feeLock).toMatch(/commission and per-sale fee stay locked/);
    } else {
      expect(lock).toMatch(new RegExp(`comisión y la tarifa fija por venta .*fijas durante ${months} meses`));
      expect(dict.home.facts.feeLock).toMatch(/comisión y la tarifa por venta fijas/);
    }
    expect(dict.home.facts.feeLock).not.toMatch(/\bplan/i);
    // 6 commitments: the clauses of the letter and the sentence that counts them.
    const clauses = Object.keys(dict.home.promise).filter((key) => /^clause\d+$/.test(key));
    expect(clauses).toHaveLength(Number(commitments));
    expect(dict.home.promise.cardSub).toMatch(word.six);
    // 14 days: always "14-day free trial", as in the rest of the site. Number and
    // caption together give the sentence of the home's final band ("14-day free trial,
    // card required."); the caption starts in lowercase because it continues the number.
    const trial = dict.home.facts.trial;
    expect(trial[0]).toBe(trial[0].toLowerCase());
    if (locale === "en") {
      expect(dict.home.creators.plansNote.startsWith(`${days}-${trial}.`)).toBe(true);
    } else {
      expect(dict.home.creators.plansNote).toMatch(new RegExp(`^Prueba gratis de ${days} días, con tarjeta\\.`));
      expect(trial).toMatch(/prueba gratis/);
      expect(trial.endsWith(", con tarjeta")).toBe(true);
    }
  });

  // The band exists in place of the competition's revenue and learner numbers:
  // no money amount and no word about earnings.
  it.each(dictionaries)("in %s does not talk about money earned", async (locale) => {
    const { container } = await renderBand(locale);

    expect(container.textContent).not.toMatch(/\$|earn|income|revenue|students|ganan|ingres|alumnos/i);
  });
});
