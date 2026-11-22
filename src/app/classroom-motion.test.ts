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

describe("a moldura da sala", () => {
  // overflow: hidden fazia da sala um conteiner de rolagem: a barra "Mark
  // complete & next", a lista de aulas e o aviso de posts novos grudavam nela
  // e rolavam junto com a pagina. clip corta os cantos sem isso.
  it("corta os cantos com clip, para o sticky grudar na tela", () => {
    expect(block(".member-classroom[data-members-theme]")).toMatch(/overflow: clip;/);
  });

  // As margens antigas miravam filhos diretos da sala e pararam de casar
  // quando o invólucro da aba entrou: os cartões encostavam na borda e, no
  // celular, o vídeo passava 14px de cada lado da tela.
  it("o invólucro da aba dá 24px de respiro (14px no celular, o que o vídeo de ponta a ponta desconta)", () => {
    expect(block(".member-classroom[data-members-theme] > .member-classroom-body")).toContain("padding: 0 24px 24px;");
    expect(css).toMatch(/\.member-classroom\[data-members-theme\] > \.member-classroom-body \{\s*padding: 0 14px 14px;/);
    expect(css).toMatch(/\.member-video-dock \{\s*margin-inline: -31px;/);
  });

  // A caixa de espera tinha 260-520px e o player que chega é 16:9: a aula
  // pulava quando o vídeo aparecia.
  it("a caixa de espera do vídeo já tem o 16:9 do player", () => {
    const loading = block(".member-video-empty--loading");
    expect(loading).toContain("aspect-ratio: 16 / 9;");
    expect(loading).toContain("min-height: 0;");
  });
});

describe("a gaveta da pergunta", () => {
  it("fundo pelo token de superfície (segue o tema), na camada dos popups", () => {
    expect(css).toMatch(/\.community-drawer \{[^}]*background: var\(--color-surface\);/);
    expect(css).not.toMatch(/\.community-drawer(__reply)? \{[^}]*background: #ffffff;/);
    expect(css).toMatch(/\.community-drawer-backdrop \{[^}]*z-index: 70;/);
  });

  it("dentro da sala lê a paleta do curso, como o texto dela", () => {
    const rule = block(".member-classroom[data-members-theme] .community-drawer");
    expect(rule).toContain("--color-surface: var(--ma-surface);");
    expect(rule).toContain("--color-ink: var(--ma-ink);");
    expect(rule).toContain("--color-line: var(--ma-line);");
  });

  it("entra deslizando, só em no-preference", () => {
    const use = css.indexOf("animation: community-drawer-in var(--duration-base) var(--ease-standard) backwards;");
    expect(use).toBeGreaterThan(-1);
    const opener = css.lastIndexOf("@media (prefers-reduced-motion: no-preference) {", use);
    expect(opener).toBeGreaterThan(-1);
    expect(use - opener).toBeLessThan(400);
    expect(css).toMatch(/@keyframes community-drawer-in \{\s*from \{\s*opacity: 0;\s*transform: translateX\(16px\);/);
  });
});
