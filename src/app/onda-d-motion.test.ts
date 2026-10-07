import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// O catálogo de movimento só existe no CSS: jsdom não anima nada, então o que
// se prova aqui é a REGRA. Mesmo desenho de classroom-motion.test.ts.
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

/** Trechos [início, fim) de cada `@media (prefers-reduced-motion: no-preference)`. */
function noPreferenceRanges(): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const opener = "@media (prefers-reduced-motion: no-preference) {";
  let from = css.indexOf(opener);
  while (from !== -1) {
    let depth = 0;
    let end = from + opener.length - 1;
    for (; end < css.length; end += 1) {
      if (css[end] === "{") depth += 1;
      if (css[end] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    ranges.push([from, end]);
    from = css.indexOf(opener, end);
  }
  return ranges;
}

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} não encontrado em globals.css`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
}

describe("catálogo de movimento: tokens", () => {
  it("soma o passar do ponto do selo e o teto de uma festa", () => {
    expect(css).toContain("--ease-pop: cubic-bezier(0.34, 1.56, 0.64, 1);");
    expect(css).toContain("--duration-celebrate: 600ms;");
  });
});

describe("catálogo de movimento: reduzir movimento desliga tudo", () => {
  const ranges = noPreferenceRanges();
  const inside = (index: number) => ranges.some(([start, end]) => index > start && index < end);

  it("toda animação do catálogo mora dentro de no-preference", () => {
    const uses = [...css.matchAll(/animation:\s*motion-[a-z-]+/g)];
    // 1 troca de etapa, 2 escolha, 4 salvo, 5 check e linha, 6 selo,
    // 7 faixa, 8 carimbo/gravura/losangos, 10 cena do vazio.
    expect(uses.length).toBeGreaterThanOrEqual(10);
    for (const use of uses) {
      expect(inside(use.index!), `fora de no-preference: ${use[0]}`).toBe(true);
    }
  });

  it("o check só vira tracejado para se desenhar; sem animação ele nasce inteiro", () => {
    const dash = css.indexOf("stroke-dasharray: 1;");
    expect(dash).toBeGreaterThan(-1);
    expect(inside(dash)).toBe(true);
  });

  it("o bloco global de reduzir movimento continua zerando animação e transição", () => {
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/animation-duration: 0\.01ms !important;/);
    expect(reduced).toMatch(/transition-duration: 0\.01ms !important;/);
  });

  it("cada animação só mexe em transform e opacity", () => {
    const keyframes = [...css.matchAll(/@keyframes (motion-[a-z-]+) \{([\s\S]*?)\n\}/g)];
    expect(keyframes.length).toBeGreaterThanOrEqual(8);
    for (const [, name, body] of keyframes) {
      const properties = [...body.matchAll(/^\s*([a-z-]+):/gm)].map((match) => match[1]);
      for (const property of properties) {
        expect(
          ["opacity", "transform", "stroke-dashoffset"],
          `${name} anima ${property}`,
        ).toContain(property);
      }
    }
  });
});

describe("catálogo de movimento: tempos", () => {
  it("o botão afunda em 120ms e volta em 180ms", () => {
    expect(css).toMatch(/transform var\(--duration-base\) var\(--ease-standard\)/);
    expect(block(".button-outline-light:active")).toContain("transition-duration: var(--duration-fast)");
  });

  it("a festa do 'Publicado!' acaba em até 700ms", () => {
    expect(block(".published-panel.is-celebrating .spot-art__seal")).toContain("motion-stamp 420ms");
    expect(block(".published-panel.is-celebrating .spot-art__engraving")).toContain(
      "var(--duration-celebrate) var(--ease-standard) 100ms",
    );
    // O último losango: 420ms de atraso + 280ms.
    expect(block(".published-panel.is-celebrating .spot-art__spark path:nth-child(3)")).toContain(
      "animation-delay: 420ms",
    );
    expect(css).toMatch(
      /\.published-panel\.is-celebrating \.spot-art__spark path \{\s*animation: motion-pop 280ms/,
    );
  });
});
