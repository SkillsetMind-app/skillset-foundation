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
const [supportsStart, supportsEnd] = blockRange(
  "@supports (animation-timeline: view()) and (animation-range: entry 0% cover 30%) and (view-timeline: --x block) {",
  mediaStart,
);

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
    // Sem os comentarios: uma regra logo abaixo de um comentario era lida
    // como "/* ... */ seletor" e escapava da conferencia.
    const body = css.slice(supportsStart, supportsEnd).replace(/\/\*[\s\S]*?\*\//g, "");
    const selectors = [...body.matchAll(/(?:^|\n)\s*([^@{}\n][^{}]*?)\s*\{/g)]
      .map((match) => match[1].trim())
      // Sobram so seletores de regra: @media e @supports aninhados e
      // comentarios nao contam.
      .filter((selector) => !selector.startsWith("@"));
    expect(selectors.length).toBeGreaterThan(35);
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

  // Os estados de partida (opacidade 0, deslocamento) so existem nos quadros
  // motion-scroll-*. Quem os usa fora do @supports esconde conteudo em
  // navegador sem a rolagem animada.
  it("nenhuma regra usa os quadros da coreografia fora do @supports", () => {
    const uses = [...css.matchAll(/animation(?:-name)?:\s*motion-scroll-/g)];
    expect(uses.length).toBeGreaterThan(10);
    for (const use of uses) {
      const inside = use.index! > supportsStart && use.index! < supportsEnd;
      expect(inside, `fora do @supports: ${css.slice(use.index!, use.index! + 60)}`).toBe(true);
    }
  });

  it("com o foco do teclado dentro, o texto do topo nao some", () => {
    const rule = css.indexOf(".home-scroll .home-hero__copy:has(:focus-visible) {");
    expect(rule).toBeGreaterThan(supportsStart);
    expect(rule).toBeLessThan(supportsEnd);
    expect(css.slice(rule, css.indexOf("}", rule))).toContain("animation: none;");
  });
});

// As tres cenas do computador: o passo a passo preso, a cortina da promessa e
// a profundidade dos cartoes. Alem das tres redes acima, um @media de tamanho:
// fora dele (celular, tela baixa) a pagina tem o layout e a altura de antes.
const scenesOpener =
  "@media (min-width: 1280px) and (min-height: 640px), (min-width: 1024px) and (min-height: 720px) {";
const [scenesStart, scenesEnd] = blockRange(scenesOpener, supportsStart);

function insideScenes(index: number): boolean {
  return index > scenesStart && index < scenesEnd;
}

/** Corpo da regra `selector {` que mora no bloco das cenas. */
function sceneRule(selector: string): string {
  const at = css.indexOf(`${selector} {`, scenesStart);
  expect(at, `${selector} nao encontrado nas cenas`).toBeGreaterThan(-1);
  expect(insideScenes(at), `${selector} fora das cenas`).toBe(true);
  return css.slice(at, css.indexOf("}", at));
}

function keyframesBody(name: string): string {
  const at = css.indexOf(`@keyframes ${name} {`);
  expect(at, `@keyframes ${name} nao encontrado`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf("\n}", at));
}

describe("home: cenas do computador", () => {
  it("o bloco de tamanho mora dentro do @supports, depois do bloco de 1024", () => {
    expect(scenesStart).toBeGreaterThan(css.indexOf("@media (min-width: 1024px) {", supportsStart));
    expect(scenesEnd).toBeLessThan(supportsEnd);
    // O painel preso so existe a partir de 1024 de largura e 640 de altura.
    for (const query of scenesOpener.slice("@media ".length, -2).split(", ")) {
      const [, width] = query.match(/min-width: (\d+)px/)!;
      const [, height] = query.match(/min-height: (\d+)px/)!;
      expect(Number(width)).toBeGreaterThanOrEqual(1024);
      expect(Number(height)).toBeGreaterThanOrEqual(640);
    }
  });

  it("faixa alta, tela presa e cortina so existem dentro do bloco de tamanho", () => {
    const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const needle of [
      ".home-how {",
      ".home-how__panel {",
      ".home-promise {",
      ".home-promise::before {",
      "220svh",
      "view-timeline: --home-how",
      "view-timeline: --home-curtain",
    ]) {
      const hits = [...css.matchAll(new RegExp(escape(needle), "g"))];
      expect(hits.length, needle).toBeGreaterThan(0);
      for (const hit of hits) {
        expect(insideScenes(hit.index!), `fora das cenas: ${needle}`).toBe(true);
      }
    }
    // Nenhum outro lugar da home gruda abaixo da barra.
    const pinned = [...css.matchAll(/position: sticky;\s+top: var\(--site-header-height\);/g)];
    expect(pinned).toHaveLength(1);
    expect(insideScenes(pinned[0].index!)).toBe(true);
  });

  it("cena 1: a faixa tem 100% de tela + 3 x 40% e o painel gruda abaixo da barra", () => {
    const track = sceneRule(".home-scroll .home-how");
    expect(track).toContain("height: calc(220svh - var(--site-header-height));");
    // A ancora pousa no instante em que a tela trava: titulo e passo 1 a vista.
    expect(track).toContain("scroll-margin-top: var(--site-header-height);");
    expect(track).toContain("view-timeline-inset: var(--site-header-height) 0px;");

    const panel = sceneRule(".home-scroll .home-how__panel");
    expect(panel).toContain("position: sticky;");
    expect(panel).toContain("top: var(--site-header-height);");
    expect(panel).toContain("min-height: calc(100svh - var(--site-header-height));");

    // Rolagem a mais do pino = faixa - painel (a barra se desconta dos dois):
    // no maximo 2,2 telas.
    const trackScreens = Number(track.match(/height: calc\((\d+)svh/)![1]);
    const panelScreens = Number(panel.match(/min-height: calc\((\d+)svh/)![1]);
    expect(trackScreens - panelScreens).toBeLessThanOrEqual(220);
    expect(trackScreens - panelScreens).toBeGreaterThanOrEqual(100);
  });

  it("cena 1: cada passo tem um dono por propriedade e acende em ordem", () => {
    const names = ["first", "second", "third"];
    names.forEach((name, index) => {
      const step = sceneRule(`.home-scroll .home-step:nth-child(${index + 1})`);
      expect(step).toContain(`animation: motion-scroll-step-${name} `);
      expect(step).toContain("animation-timeline: --home-how;");
      expect(keyframesBody(`motion-scroll-step-${name}`)).not.toContain("transform");
      expect(keyframesBody(`motion-scroll-mark-${name}`)).not.toContain("opacity");
    });

    // Calmo nunca abaixo de 0.5; no fim (100%) os tres estao inteiros.
    for (const name of names) {
      const body = keyframesBody(`motion-scroll-step-${name}`);
      for (const [, value] of body.matchAll(/opacity: ([\d.]+);/g)) {
        expect(Number(value)).toBeGreaterThanOrEqual(0.5);
      }
      const last = body.slice(body.lastIndexOf("100%"));
      expect(last).toMatch(/opacity: 1;/);
    }
  });

  it("cena 2: a cortina e decorativa, da cor de tokens e cortada pela faixa", () => {
    const band = sceneRule(".home-scroll .home-promise");
    expect(band).toContain("overflow: clip;");
    expect(band).toContain("--home-curtain: var(--color-primary);");
    const dark = sceneRule('[data-theme="dark"] .home-scroll .home-promise');
    expect(dark).toContain("--home-curtain: var(--color-surface-soft);");

    const curtain = sceneRule(".home-scroll .home-promise::before");
    expect(curtain).toContain('content: "";');
    expect(curtain).toContain("pointer-events: none;");
    expect(curtain).toContain("background: var(--home-curtain);");
    expect(curtain).toContain("animation-range: cover 0% cover 45svh;");
  });

  it("cena 2: o texto so sobe depois que a cortina cobre o conteudo, e nunca fica apagado com foco", () => {
    // A cortina cobre o conteudo em 29% do trecho de 45svh (~13svh); texto,
    // carta e clausulas comecam depois, nessa ordem.
    const curtainBody = keyframesBody("motion-scroll-curtain");
    expect(curtainBody).toMatch(/29% \{\s*transform: scale\(0\.86\);/);
    const start = (selector: string) =>
      Number(sceneRule(selector).match(/animation-range: cover (\d+)svh/)![1]);
    expect(start(".home-scroll .home-promise__text")).toBeGreaterThan(45 * 0.29);
    expect(start(".home-scroll .home-promise__charter")).toBeGreaterThan(
      start(".home-scroll .home-promise__text"),
    );
    // Inteiros antes dos 75% da tela: o fim do trecho fica abaixo de 25svh
    // da propria regua mais o recuo de cima da faixa (96px).
    expect(sceneRule(".home-scroll .home-promise__clause:nth-child(n)")).toContain(
      "animation-range: cover 4svh cover 16svh;",
    );
    expect(sceneRule(".home-scroll .home-promise__text:has(:focus-visible)")).toContain(
      "animation: none;",
    );
  });

  it("cena 3: a foto do curso anima sem prender o transform do hover", () => {
    const photo = sceneRule(".home-scroll .marketplace-course-grid > li .marketplace-card__media > img");
    expect(photo).toContain("animation: motion-scroll-settle 1ms var(--ease-standard) backwards;");
    expect(photo).not.toMatch(/\b(?:both|forwards)\b/);
    // O hover aprovado (500ms) continua o primeiro `.marketplace-card__media img {`.
    expect(css.indexOf(".marketplace-card__media img {")).toBeGreaterThan(supportsEnd);
  });

  it("os quadros novos so mexem em transform e opacity", () => {
    for (const name of [
      "motion-scroll-step-first",
      "motion-scroll-step-second",
      "motion-scroll-step-third",
      "motion-scroll-mark-first",
      "motion-scroll-mark-second",
      "motion-scroll-mark-third",
      "motion-scroll-curtain",
      "motion-scroll-assemble",
      "motion-scroll-settle",
    ]) {
      const properties = [...keyframesBody(name).matchAll(/^\s*([a-z-]+):/gm)].map((match) => match[1]);
      expect(properties.length, name).toBeGreaterThan(0);
      for (const property of properties) {
        expect(["opacity", "transform"], `${name} anima ${property}`).toContain(property);
      }
    }
  });

  it("o topo nao entra nas cenas", () => {
    const body = css.slice(scenesStart, scenesEnd);
    expect(body).not.toMatch(/home-hero|hero-portrait|hero-copy/);
  });

  it("os ganchos das cenas continuam no JSX", () => {
    const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
    expect(read("src/app/page.tsx")).toMatch(/id="how-it-works" className="home-how /);
    expect(read("src/components/site/how-it-works-strip.tsx")).toContain('className="home-how__panel ');
    expect(read("src/components/site/promise-preview-band.tsx")).toContain('className="home-promise ');
  });

  it("nenhum ancestral da home corta a rolagem (o sticky precisa disso)", () => {
    const shell = css.slice(css.indexOf(".page-shell {"), css.indexOf("}", css.indexOf(".page-shell {")));
    expect(shell).toContain("overflow-x: clip;");
    expect(shell).not.toMatch(/overflow(?:-[xy])?: (?:hidden|auto|scroll)/);
  });
});
