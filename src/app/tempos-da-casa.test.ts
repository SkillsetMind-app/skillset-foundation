import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// O contrato de movimento tem três tempos (120, 180 e 280ms) e uma curva. O
// que sobrava fora dele (150, 160, 200, 220ms) nos controles da plataforma
// fazia vizinhos andarem em ritmos diferentes. Ficam de fora, de propósito: o
// movimento da home aprovado no #576 (entrada do hero, cartão e foto da
// vitrine), os tempos que outro teste já fixa (cabeçalho do site em
// site-frame, seções em reveal-without-js) e a escala do apertar
// (onda-d-motion). jsdom não anima nada: o que se prova aqui é a REGRA do CSS.
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} não encontrado`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
}

describe("tempos da casa", () => {
  it("toda utility transition-* sem duração usa o tempo da casa", () => {
    const theme = block("@theme");
    expect(theme).toContain("--default-transition-duration: var(--duration-base);");
    // A curva das utilities fica a do Tailwind, de propósito: o movimento do
    // site público (hover da home, do rodapé, das setas) foi aprovado assim.
    expect(theme).not.toContain("--default-transition-timing-function");
  });

  // O movimento da home foi aprovado como está (#576). Uma troca de tokens
  // não pode encurtá-lo sem ninguém ver.
  it("a entrada do hero e a foto da vitrine guardam o tempo e a curva aprovados", () => {
    expect(block(".hero-copy-rise")).toContain("animation: hero-copy-rise 620ms cubic-bezier(0.2, 0.6, 0.2, 1) both;");
    expect(block(".marketplace-card__media img")).toContain("transform 500ms cubic-bezier(0.2, 0.6, 0.2, 1)");
  });

  it.each([
    ".field-input",
    ".platform-nav-section-chevron",
    ".dash-card",
    ".studio-payout-chip",
  ])("%s anda nos tokens, sem milissegundo solto", (selector) => {
    const body = block(selector);
    expect(body).toMatch(/var\(--duration-(base|slow)\) var\(--ease-standard\)/);
    expect(body).not.toMatch(/\d+ms/);
  });
});
