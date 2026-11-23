import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// O contrato de movimento tem três tempos (120, 180 e 280ms) e uma curva. O
// que sobrava fora dele (150, 160, 200, 220, 500, 620ms) fazia controles
// vizinhos andarem em ritmos diferentes. Ficam de fora, de propósito, os
// tempos que outro teste já fixa (cabeçalho do site em site-frame, seções em
// reveal-without-js) e a escala do apertar (onda-d-motion). jsdom não anima
// nada: o que se prova aqui é a REGRA do CSS.
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} não encontrado`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
}

describe("tempos da casa", () => {
  it("toda utility transition-* sem duração usa os tokens", () => {
    const theme = block("@theme");
    expect(theme).toContain("--default-transition-duration: var(--duration-base);");
    expect(theme).toContain("--default-transition-timing-function: var(--ease-standard);");
  });

  it.each([
    ".field-input",
    ".platform-nav-section-chevron",
    ".dash-card",
    ".studio-payout-chip",
    ".marketplace-card",
    ".marketplace-card__media img",
    ".hero-copy-rise",
  ])("%s anda nos tokens, sem milissegundo solto", (selector) => {
    const body = block(selector);
    expect(body).toMatch(/var\(--duration-(base|slow)\) var\(--ease-standard\)/);
    expect(body).not.toMatch(/\d+ms/);
  });
});
