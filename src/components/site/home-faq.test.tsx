import { readFileSync } from "node:fs";
import { join } from "node:path";

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HomeFaq } from "@/components/site/home-faq";
import { helpFaqCategories } from "@/data/help-faq";
import en from "@/data/i18n/en.json";
import es from "@/data/i18n/es.json";

// Server component: o idioma vem do cookie.
const state = vi.hoisted(() => ({ locale: "en" }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: state.locale }) }) }));

afterEach(() => {
  cleanup();
  state.locale = "en";
});

const dictionaries = [["en", en], ["es", es]] as const;

// As perguntas escolhidas, na ordem da home: [categoria do /help, posição].
const expected = [
  ["plans", 0],
  ["payouts", 0],
  ["plans", 2],
  ["refunds", 0],
  ["course-creation", 0],
  ["integrations", 0],
] as const;

const at = (dict: object, path: string) =>
  path.split(".").reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], dict) as string;

describe("perguntas frequentes da home", () => {
  it.each(dictionaries)("em %s mostra as perguntas e respostas da central de ajuda, sem reescrever", async (locale, dict) => {
    state.locale = locale;
    const { container } = render(await HomeFaq());

    expect(container.querySelector("h2")?.textContent).toBe(dict.publicPages.pricing.common_questions);
    expect(container.textContent).toContain(dict.footer.helpCenter);

    const items = [...container.querySelectorAll("details")];
    expect(items).toHaveLength(expected.length);
    items.forEach((item, position) => {
      const [category, index] = expected[position];
      const key = `publicPages.helpFaq.${category}.items.${index}`;
      // Fechadas ao chegar: quem quer, abre.
      expect(item).not.toHaveAttribute("open");

      const summary = item.querySelector("summary")!;
      expect(summary.textContent).toBe(at(dict, `${key}.q`));
      expect(item.querySelector("p")?.textContent).toBe(at(dict, `${key}.a`));

      // A resposta termina com o link para a categoria dela no /help, e o link
      // leva a pergunta como descrição.
      const links = item.querySelectorAll("a");
      expect(links).toHaveLength(1);
      expect(item.lastElementChild?.lastElementChild).toBe(links[0]);
      expect(links[0]).toHaveAttribute("href", `/help#${category}`);
      expect(links[0].textContent).toBe(dict.home.faq.more);
      const describedBy = container.querySelector(`#${links[0].getAttribute("aria-describedby")}`);
      expect(describedBy?.textContent).toBe(at(dict, `${key}.q`));
      expect(summary.contains(describedBy)).toBe(true);
    });
  });

  // O link só serve se o /help tiver a categoria e a pergunta: a página monta
  // as seções a partir de helpFaqCategories, com o id da categoria.
  it("cada pergunta existe no /help, na categoria para onde o link leva", () => {
    for (const [category, index] of expected) {
      const section = helpFaqCategories.find((item) => item.id === category);
      expect(section, category).toBeDefined();
      expect(section!.items[index], `${category}.${index}`).toBeDefined();
      // A mesma pergunta que o /help mostra em inglês.
      expect(at(en, `publicPages.helpFaq.${category}.items.${index}.q`)).toBe(section!.items[index].q);
    }
  });

  // Sem JavaScript: <details> nativo. A seta gira ao abrir e só anda com
  // movimento liberado (motion-safe), nos tempos da casa.
  it("abre e fecha sem JavaScript, e a seta só anda com movimento liberado", async () => {
    const source = readFileSync(join(process.cwd(), "src/components/site/home-faq.tsx"), "utf8");
    expect(source).not.toContain('"use client"');
    expect(source).not.toMatch(/\bon[A-Z][a-zA-Z]*=/);

    const { container } = render(await HomeFaq());
    for (const chevron of container.querySelectorAll("summary svg")) {
      const classes = chevron.getAttribute("class") ?? "";
      expect(classes).toContain("group-open:rotate-180");
      expect(classes).toContain("motion-safe:transition-transform");
      expect(classes).toContain("motion-safe:duration-[var(--duration-base)]");
      expect(classes.split(" ")).not.toContain("transition-transform");
    }
    // Alvo de toque de 48px ou mais na pergunta e no link.
    for (const summary of container.querySelectorAll("summary")) expect(summary).toHaveClass("min-h-14", "text-lg");
    for (const link of container.querySelectorAll("details a")) expect(link).toHaveClass("min-h-12");
  });
});
