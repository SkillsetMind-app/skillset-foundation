import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Movimento que so existe no CSS: jsdom nao anima nada, entao o que se prova
// aqui e a REGRA — que a propriedade transiciona, e com que atraso. Mesmo
// desenho de theme-tokens.test.tsx.
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} nao encontrado em globals.css`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("\n}", start));
}

describe("a barra de progresso da sala", () => {
  // Concluir uma aula reescrevia a largura de uma vez: a barra SALTAVA para a
  // marca nova e o unico sinal de "isso contou" passava batido.
  it("anima a largura em vez de saltar para a marca nova", () => {
    expect(block(".member-classroom-head__progress > span")).toMatch(
      /transition: width \d+ms/,
    );
  });
});

describe("os rotulos da barra lateral", () => {
  // A largura do rail leva 240ms e o rotulo levava 180ms COMECANDO JUNTO: o
  // texto aparecia dentro de uma barra ainda estreita, e sumia antes de ela
  // encolher — as duas coisas correndo uma por cima da outra.
  it("ao ABRIR, esperam a largura terminar antes de aparecer", () => {
    const label = block(".platform-sidebar-label");
    expect(label).toContain("opacity 180ms ease 180ms");
    expect(label).toContain("transform 180ms ease 180ms");
  });

  it("ao FECHAR, saem na hora — sem o atraso da abertura", () => {
    expect(block(".sidebar-collapsed .platform-sidebar-label")).toContain(
      "transition-delay: 0s",
    );
  });

  it("com prefers-reduced-motion, nem largura nem rotulo animam", () => {
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toContain(".platform-sidebar-label");
    expect(reduced).toMatch(/\.platform-sidebar-label \{\s*transition: none;/);
  });
});

describe("o cartao 'Proxima aula'", () => {
  // Ele aparecia seco sobre o video e sumia igual.
  it("entra subindo com fade", () => {
    expect(block(".member-next-lesson")).toMatch(
      /animation: member-next-lesson-in \d+ms/,
    );
    const keyframes = css.slice(css.indexOf("@keyframes member-next-lesson-in"));
    expect(keyframes.slice(0, 200)).toContain("translateY(12px)");
  });

  it("sai descendo — e a entrada e cancelada, senao o fill segurava o estado", () => {
    const leaving = block(".member-next-lesson.is-leaving");
    expect(leaving).toContain("animation: none");
    expect(leaving).toContain("transform: translateY(12px)");
    expect(leaving).toMatch(/transition:\s*\n?\s*opacity \d+ms/);
  });
});
