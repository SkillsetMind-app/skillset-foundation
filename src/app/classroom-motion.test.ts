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
  // Entrada e saída no tempo do sistema (180ms), não nos 250ms de antes.
  it("entra subindo com fade", () => {
    expect(block(".member-next-lesson")).toMatch(
      /animation: member-next-lesson-in var\(--duration-base\) var\(--ease-standard\)/,
    );
    const keyframes = css.slice(css.indexOf("@keyframes member-next-lesson-in"));
    expect(keyframes.slice(0, 200)).toContain("translateY(12px)");
  });

  it("sai descendo — e a entrada e cancelada, senao o fill segurava o estado", () => {
    const leaving = block(".member-next-lesson.is-leaving");
    expect(leaving).toContain("animation: none");
    expect(leaving).toContain("transform: translateY(12px)");
    expect(leaving).toMatch(/transition:\s*\n?\s*opacity var\(--duration-base\) var\(--ease-standard\)/);
  });

  // Com o mini player ligado o cartão nascia dentro do vídeo de ~150x84px.
  it("com o mini player ligado vira uma faixa logo abaixo dele", () => {
    const media = css.lastIndexOf(
      "@media (max-width: 767.98px) {",
      css.indexOf(".member-video-dock--mini .member-next-lesson {"),
    );
    expect(media).toBeGreaterThan(-1);
    expect(block(".member-video-dock--mini .member-video-stage:has(> .member-next-lesson)")).toContain("position: static;");
    const strip = block(".member-video-dock--mini .member-next-lesson");
    expect(strip).toContain("top: 100%;");
    expect(strip).toContain("bottom: auto;");
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
  // A barra presa no pé (~69px) escondia o item focado pelo Tab (WCAG 2.4.11).
  it("com a aula aberta, a rolagem do foco para acima da barra presa", () => {
    const [, padding] = css.match(/html:has\(#member-lesson-player\) \{\s*scroll-padding-bottom: (\d+)px;/)!;
    expect(Number(padding)).toBeGreaterThanOrEqual(69);
  });

  // A barra rola de lado e corta o que passa da borda: o anel de foco (2px
  // + 3px de afastamento) da primeira aba sumia à esquerda.
  it("a barra de abas tem folga por dentro para o anel de foco", () => {
    const [, padding] = block(".member-classroom[data-members-theme] > .member-classroom-tabs").match(/padding-inline: (\d+)px;/)!;
    expect(Number(padding)).toBeGreaterThanOrEqual(5);
  });

  // "Watch now": o ícone pegava a cor da regra da plataforma e o rótulo a do
  // curso, cada um de um jeito.
  it("ícone e rótulo do botão cheio da sala usam a mesma cor do curso", () => {
    expect(css).toMatch(
      /\.member-classroom\[data-members-theme\] \.button-solid \*,[\s\S]{0,200}?\{\s*color: var\(--ma-on-accent\) !important;/,
    );
  });

  // Brilho vermelho fixo sob todo botão cheio, e contorno com hover vermelho,
  // mesmo num curso verde ou azul.
  it("botões da sala sem vermelho fixo: sombra navy e realce na cor do curso", () => {
    expect(block(".member-classroom[data-members-theme] .button-accent:hover")).toContain(
      "box-shadow: var(--shadow-button-strong);",
    );
    expect(css).toMatch(
      /\.member-classroom\[data-members-theme\] \.button-accent \{[^}]*box-shadow: var\(--shadow-button\);/,
    );
    expect(block(".member-classroom[data-members-theme] .button-outline:hover")).toContain(
      "background: color-mix(in srgb, var(--ma-accent) 10%, transparent);",
    );
  });

  it("sobras de 160/200ms da sala no tempo do sistema", () => {
    expect(block(".member-playlist__chevron")).toContain("transform var(--duration-base) var(--ease-standard)");
    expect(css).toMatch(/animation: member-video-mini-in var\(--duration-base\) var\(--ease-standard\);/);
  });

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
    // Erro e "respondida": no curso escuro o vermelho e o verde da plataforma
    // davam ~2.7:1. Vale para a gaveta e para os cartões do feed da sala.
    expect(css).toMatch(
      /\.member-classroom\[data-members-theme\] \.community-drawer,\s*\.member-classroom\[data-members-theme\] \[data-community-item\] \{\s*--color-danger-fg: var\(--ma-accent-ink\);\s*--color-success-fg: var\(--ma-success-ink\);/,
    );
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
