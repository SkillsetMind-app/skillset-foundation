import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// A coreografia de rolagem da home so existe no CSS (animation-timeline):
// jsdom nao rola nem anima, entao o que se prova aqui sao as tres redes de
// seguranca da regra. Mesmo desenho de onda-d-motion.test.ts.
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

/** Trecho [inicio, fim) do bloco que comeca em `opener`, contando chaves. */
function blockRange(opener: string, from = 0): [number, number] {
  const start = css.indexOf(opener, from);
  expect(start, `${opener} nao encontrado`).toBeGreaterThan(-1);
  let depth = 0;
  let end = start + opener.length - 1;
  for (; end < css.length; end += 1) {
    if (css[end] === "{") depth += 1;
    if (css[end] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return [start, end];
}

const sectionStart = css.indexOf("Home: coreografia de rolagem");
const [mediaStart, mediaEnd] = blockRange("@media (prefers-reduced-motion: no-preference) {", sectionStart);
const [supportsStart, supportsEnd] = blockRange("@supports (animation-timeline: view()) {", mediaStart);

describe("home: coreografia de rolagem", () => {
  it("toda linha do tempo de rolagem mora dentro de no-preference E do @supports", () => {
    expect(sectionStart).toBeGreaterThan(-1);
    expect(supportsStart).toBeGreaterThan(mediaStart);
    expect(supportsEnd).toBeLessThan(mediaEnd);

    const uses = [...css.matchAll(/(?:animation|view)-timeline:/g)];
    expect(uses.length).toBeGreaterThan(10);
    for (const use of uses) {
      const inside = use.index! > supportsStart && use.index! < supportsEnd;
      expect(inside, `fora do @supports: ${css.slice(use.index!, use.index! + 60)}`).toBe(true);
    }
  });

  it("so a home entra na coreografia: toda regra e escopada em .home-scroll", () => {
    const body = css.slice(supportsStart, supportsEnd);
    const selectors = [...body.matchAll(/(?:^|\n)\s*([^@{}\n][^{}]*?)\s*\{/g)]
      .map((match) => match[1].trim())
      // Sobram so seletores de regra: @media e @supports aninhados e
      // comentarios nao contam.
      .filter((selector) => !selector.startsWith("/*") && !selector.startsWith("@"));
    expect(selectors.length).toBeGreaterThan(20);
    for (const selector of selectors) {
      for (const part of selector.split(",")) {
        expect(part, `regra fora da home: ${part.trim()}`).toMatch(/\.home-scroll/);
      }
    }
  });

  it("sem suporte ou com movimento reduzido a barra de leitura nao aparece", () => {
    const base = css.indexOf(".home-scroll-progress {", sectionStart);
    expect(base).toBeGreaterThan(-1);
    expect(base).toBeLessThan(mediaStart);
    expect(css.slice(base, css.indexOf("}", base))).toContain("display: none;");
  });

  it("nada some de vez: a entrada antiga so e desligada dentro do @supports", () => {
    const off = css.indexOf("html.js .home-scroll .reveal-on-view:not(.reveal-on-view--in) {");
    expect(off).toBeGreaterThan(supportsStart);
    expect(off).toBeLessThan(supportsEnd);
  });
});
