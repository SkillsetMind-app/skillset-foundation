import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HomeFactsBand } from "@/components/site/home-facts-band";
import { PLAN_TRIAL_DAYS } from "@/data/plans";
import en from "@/data/i18n/en.json";
import es from "@/data/i18n/es.json";
import { supportedStripeCurrencies } from "@/lib/payments/currencies";

// Server component: o idioma vem do cookie.
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

describe("faixa de fatos da home", () => {
  // Exatamente os quatro fatos escolhidos, nesta ordem, com a legenda de cada
  // um. A legenda do teste é a da /for-creators, reaproveitada sem mudar.
  it.each(dictionaries)("em %s mostra só os quatro fatos, com as legendas do dicionário", async (locale, dict) => {
    const { container, pairs } = await renderBand(locale);

    expect(pairs).toEqual([
      ["30", dict.home.facts.currencies],
      [dict.home.facts.feeLockMonths, dict.home.facts.feeLock],
      [dict.home.facts.commitmentsCount, dict.home.facts.commitments],
      ["14", dict.publicPages.creators.to_start],
    ]);
    // Lista de definição de verdade: cada fato é um <div> com um <dt> e um <dd>.
    expect(container.querySelectorAll("dl > div > dt")).toHaveLength(4);
    expect(container.querySelectorAll("dl > div > dd")).toHaveLength(4);
    expect(container.querySelectorAll("dl > :not(div)")).toHaveLength(0);
    // Fato não é link: nada aqui leva a lugar nenhum.
    expect(container.querySelector("a")).toBeNull();
  });

  it.each(dictionaries)("em %s a seção tem nome: um título escondido, lido pelo leitor de tela", async (locale, dict) => {
    const { container } = await renderBand(locale);

    const section = container.querySelector("section");
    const title = container.querySelector(`#${section?.getAttribute("aria-labelledby")}`);
    expect(title?.tagName).toBe("H2");
    expect(title).toHaveClass("sr-only");
    expect(title?.textContent).toBe(dict.home.facts.title);
  });

  // Cada número já está escrito em outro lugar do site, com a mesma conta.
  // Se o produto mudar (outra quantidade de moedas, outro prazo de teste) ou a
  // frase de origem mudar, este teste quebra antes de a faixa mentir.
  it.each(dictionaries)("em %s cada número é o mesmo da frase que o site já publica", (locale, dict) => {
    const [currencies, months, commitments, days] = [
      String(supportedStripeCurrencies.length),
      dict.home.facts.feeLockMonths,
      dict.home.facts.commitmentsCount,
      String(PLAN_TRIAL_DAYS),
    ];
    const word = locale === "en"
      ? { currencies: "currencies", months: "months", six: /^Six commitments/ }
      : { currencies: "monedas", months: "meses", six: /^Seis compromisos/ };

    // 30 moedas: o cartão de recursos da home e o topo.
    expect(dict.home.capabilities.c4Desc).toContain(`${currencies} ${word.currencies}`);
    expect(dict.home.hero.trust2Desc).toContain(`${currencies} ${word.currencies}`);
    // 24 meses: a cláusula 01 da Promessa, na home e na /promise.
    expect(dict.home.promise.clause1).toContain(`${months} ${word.months}`);
    expect(dict.publicPages.promise.fee_lock_for_24_months).toContain(`${months} ${word.months}`);
    // 6 compromissos: as cláusulas da carta e a frase que as conta.
    const clauses = Object.keys(dict.home.promise).filter((key) => /^clause\d+$/.test(key));
    expect(clauses).toHaveLength(Number(commitments));
    expect(dict.home.promise.cardSub).toMatch(word.six);
    // 14 dias: sempre "14-day free trial", como no resto do site.
    expect(dict.home.creators.plansNote).toMatch(
      locale === "en" ? `${days}-day free trial` : new RegExp(`prueba gratis de ${days} días`, "i"),
    );
  });

  // A faixa existe no lugar dos números de receita e de alunos da concorrência:
  // nenhum valor em dinheiro e nenhuma palavra de ganho.
  it.each(dictionaries)("em %s não fala de dinheiro ganho", async (locale) => {
    const { container } = await renderBand(locale);

    expect(container.textContent).not.toMatch(/\$|earn|income|revenue|students|ganan|ingres|alumnos/i);
  });
});
