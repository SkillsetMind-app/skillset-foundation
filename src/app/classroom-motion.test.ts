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
  // Onda E: a largura do rail troca na hora (animar a coluna refazia o layout
  // da pagina a cada quadro), e o rotulo so acende. Antes a largura levava
  // 240ms e o rotulo esperava 180ms para nao correr por cima dela.
  it("fora de no-preference o rotulo nao anima; dentro, so a opacidade, em 180ms", () => {
    expect(block(".platform-sidebar-label")).not.toContain("transition");
    const motion = css.slice(css.indexOf("/* 14. Menu lateral (onda E)."));
    expect(motion.slice(0, 600)).toMatch(
      /\.platform-sidebar-label \{\s*transition: opacity var\(--duration-base\) var\(--ease-standard\);/,
    );
    const opener = css.lastIndexOf("@media (prefers-reduced-motion: no-preference) {", css.indexOf("/* 14. Menu lateral"));
    expect(opener).toBeGreaterThan(-1);
  });

  it("com prefers-reduced-motion nada anda: o bloco global zera as transicoes", () => {
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/transition-duration: 0\.01ms !important;/);
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
