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

/** cubic-bezier(0.2, 0.6, 0.2, 1), a --ease-standard. */
function easeStandard(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bezier = (t: number, p1: number, p2: number) =>
    3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t * t * p2 + t ** 3;
  let [lo, hi] = [0, 1];
  for (let i = 0; i < 50; i += 1) {
    const mid = (lo + hi) / 2;
    if (bezier(mid, 0.2, 0.2) < x) lo = mid;
    else hi = mid;
  }
  return bezier((lo + hi) / 2, 0.6, 1);
}

/** A cortina lida do CSS: geometria da elipse, escala por trecho e regua. */
function curtainModel() {
  const rule = sceneRule(".home-scroll .home-promise::before");
  const percent = (property: string) =>
    Number(rule.match(new RegExp(`\\s${property}: (-?[\\d.]+)%;`))![1]) / 100;
  const [width, height] = [percent("width"), percent("height")];
  const stops = [
    ...keyframesBody("motion-scroll-curtain").matchAll(
      /(\d+)% \{\s*transform: (?:scale\(([\d.]+)\)|none);/g,
    ),
  ].map(([, at, scale]) => [Number(at) / 100, scale ? Number(scale) : 1] as const);
  const stretch = Number(rule.match(/animation-range: cover 0% cover (\d+)svh;/)![1]) / 100;
  const scaleAt = (u: number) => {
    if (u <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i += 1) {
      const [u0, s0] = stops[i - 1];
      const [u1, s1] = stops[i];
      if (u <= u1) return s0 + ((s1 - s0) * (u - u0)) / (u1 - u0);
    }
    return stops[stops.length - 1][1];
  };
  return {
    kh: width / 2,
    kv: height / 2,
    top: percent("top"),
    left: percent("left"),
    stretch,
    scaleAt,
    /** y (px abaixo do topo da faixa) da borda do arco em dx, com o topo da faixa subido `o` telas. */
    edgeAt(dx: number, o: number, bandWidth: number, bandHeight: number) {
      const s = scaleAt(o / stretch);
      const a = (width / 2) * bandWidth * s;
      if (Math.abs(dx) >= a) return bandHeight;
      return bandHeight - (height / 2) * bandHeight * s * Math.sqrt(1 - (dx / a) ** 2);
    },
  };
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
  });

  it("cena 2: o arco nasce no meio da borda de baixo, cobre os cantos em 1 e nao corta reto antes de 85%", () => {
    const arc = curtainModel();
    // Centro da elipse no meio da borda de baixo da faixa.
    expect(arc.left + arc.kh).toBeCloseTo(0.5, 5);
    expect(arc.top + arc.kv).toBeCloseTo(1, 5);
    // Em escala 1 o arco passa dos cantos de cima (a 50% da largura).
    expect(arc.kv * Math.sqrt(1 - (0.5 / arc.kh) ** 2)).toBeGreaterThan(1);
    // Trecho: do topo da faixa no fundo da tela ao topo a 45% da tela.
    expect(arc.stretch).toBe(0.55);
    expect(arc.scaleAt(0)).toBeLessThanOrEqual(0.15);
    expect(arc.scaleAt(1)).toBe(1);
    for (let u = 0; u < 0.84; u += 0.01) {
      expect(arc.kv * arc.scaleAt(u), `topo cortado reto em ${u.toFixed(2)}`).toBeLessThan(1);
    }
  });

  it("cena 2: cada bloco de texto so aparece coberto, em ordem, e fica inteiro antes de 75% da tela", () => {
    const arc = curtainModel();
    const range = (selector: string) => {
      const [, from, to] = sceneRule(selector).match(/animation-range: cover (\d+)svh cover (\d+)svh;/)!;
      return [Number(from) / 100, Number(to) / 100] as const;
    };
    // Recuos medidos a partir do topo da faixa (estimados no layout de 1024
    // e de 1280+): sobretitulo, titulo, paragrafo e botao; a carta a 96px,
    // com o primeiro texto dela a 124px.
    const blocks = [
      { selector: ".home-scroll .home-promise__text > *", offset: 0 },
      { selector: ".home-scroll .home-promise__text > h2", offset: 28 },
      { selector: ".home-scroll .home-promise__text > h2 + p", offset: 164 },
      { selector: ".home-scroll .home-promise__text > a", offset: 244 },
    ].map((block) => ({ ...block, range: range(block.selector) }));
    const charter = range(".home-scroll .home-promise__charter");

    const starts = [...blocks.map((block) => block.range[0]), charter[0]];
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    expect(new Set(starts).size).toBe(starts.length);

    for (const { width, half, eyebrow } of [
      { width: 1024, half: 480, eyebrow: 171 },
      { width: 1440, half: 608, eyebrow: 185 },
    ]) {
      for (const bandHeight of [620, 660, 720]) {
        for (const vh of [720, 900, 1080, 1200]) {
          const where = `${width}x${vh}, faixa ${bandHeight}px`;
          for (const block of blocks) {
            const y = eyebrow + block.offset;
            const [from, to] = block.range;
            // Texto claro so com a cortina por tras (canto esquerdo da coluna).
            expect(arc.edgeAt(-half, from, width, bandHeight), `${block.selector} sem cortina, ${where}`)
              .toBeLessThanOrEqual(y);
            // Inteiro quando o topo dele chega a 75% da tela.
            const deadline = 0.25 + y / vh;
            expect(easeStandard((deadline - from) / (to - from)), `${block.selector} apagado, ${where}`)
              .toBeGreaterThanOrEqual(0.95);
          }
          // A carta so entra com a borda de cima dela (canto direito) coberta.
          expect(arc.edgeAt(half, charter[0], width, bandHeight), `carta boiando, ${where}`).toBeLessThanOrEqual(96);
          const deadline = 0.25 + 124 / vh;
          expect(easeStandard((deadline - charter[0]) / (charter[1] - charter[0])), `carta apagada, ${where}`)
            .toBeGreaterThanOrEqual(0.95);
          // A primeira clausula (285px) comeca depois da carta.
          const [clauseFrom] = range(".home-scroll .home-promise__clause:nth-child(n)");
          expect(clauseFrom + 285 / vh).toBeGreaterThan(charter[0]);
        }
      }
    }

    expect(
      sceneRule(".home-scroll .home-promise:has(:focus-visible) .home-promise__text > *"),
    ).toContain("animation: none;");
    // O botao larga o transform no fim da entrada: o :hover dele volta a valer.
    expect(sceneRule(".home-scroll .home-promise__text > a")).toContain(
      "animation: motion-scroll-rise 1ms var(--ease-standard) backwards;",
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
      "motion-scroll-fact",
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

  // M6: a faixa de fatos entra nos dois tamanhos (fora do bloco das cenas),
  // um número depois do outro, só com opacidade e 12px. Fora das travas não
  // existe regra nenhuma para ela: parada e inteira.
  it("faixa de fatos: escada leve atrás das travas, inteira antes de 75% da tela", () => {
    const hits = [...css.matchAll(/\.home-facts/g)];
    expect(hits.length).toBe(4);
    for (const hit of hits) {
      expect(hit.index! > supportsStart && hit.index! < supportsEnd, "fato fora do @supports").toBe(true);
      expect(insideScenes(hit.index!), "fato preso ao bloco das cenas").toBe(false);
    }

    const rule = (selector: string) => {
      const at = css.indexOf(`${selector} {`, supportsStart);
      expect(at, selector).toBeGreaterThan(-1);
      return css.slice(at, css.indexOf("}", at));
    };
    const base = rule(".home-scroll .home-facts__item");
    expect(base).toContain("animation: motion-scroll-fact 1ms var(--ease-standard) both;");
    expect(base).toContain("animation-timeline: view();");

    // Trechos em svh a partir do topo do fato entrando pela borda de baixo:
    // começos em ordem e cada fim antes de o topo chegar a 75% da tela.
    const ranges = [1, 2, 3, 4].map((n) => {
      const body = n === 1 ? base : rule(`.home-scroll .home-facts__item:nth-child(${n})`);
      const [, from, to] = body.match(/animation-range: cover (\d+)(?:%|svh) cover (\d+)svh;/)!;
      return [Number(from), Number(to)] as const;
    });
    for (let i = 1; i < ranges.length; i += 1) {
      expect(ranges[i][0]).toBeGreaterThan(ranges[i - 1][0]);
    }
    for (const [from, to] of ranges) {
      expect(to).toBeGreaterThan(from);
      expect(to).toBeLessThanOrEqual(25);
    }

    const frames = keyframesBody("motion-scroll-fact");
    expect(frames).toContain("opacity: 0;");
    expect(frames).toContain("transform: translateY(12px);");
  });

  it("nenhum ancestral da home corta a rolagem (o sticky precisa disso)", () => {
    const shell = css.slice(css.indexOf(".page-shell {"), css.indexOf("}", css.indexOf(".page-shell {")));
    expect(shell).toContain("overflow-x: clip;");
    expect(shell).not.toMatch(/overflow(?:-[xy])?: (?:hidden|auto|scroll)/);
  });

  // Fotos da home: a faixa "para quem é" e a foto da faixa final só se mexem
  // no computador, num bloco de 1024px depois de todas as outras regras. No
  // celular e no tablet nada delas anda.
  it("fotos da home: movimento só no computador, e a foto final assenta antes do título", () => {
    const [start, end] = blockRange("@media (min-width: 1024px) {", css.indexOf("12. Fotos da home"));
    expect(start).toBeGreaterThan(scenesEnd);
    expect(end).toBeLessThan(supportsEnd);
    for (const needle of [/\.home-who/g, /\.home-creators__photo/g]) {
      const hits = [...css.matchAll(needle)];
      expect(hits.length, String(needle)).toBeGreaterThan(0);
      for (const hit of hits) {
        expect(hit.index! > start && hit.index! < end, `${needle} fora do bloco do computador`).toBe(true);
      }
    }

    const rule = (selector: string) => {
      const at = css.indexOf(`${selector} {`, start);
      expect(at, selector).toBeGreaterThan(-1);
      expect(at, selector).toBeLessThan(end);
      return css.slice(at, css.indexOf("}", at));
    };
    const range = (body: string) =>
      body.match(/animation-range: cover (\d+)(?:%|svh) cover (\d+)svh;/)!.slice(1).map(Number);

    // A faixa de ponta a ponta não cresce; a foto recua até assentar, e o
    // título só começa com a foto 3/4 do caminho andado.
    expect(rule(".home-scroll .home-creators")).toContain("animation: none;");
    const photo = rule(".home-scroll .home-creators__photo img");
    expect(photo).toContain("animation: motion-scroll-settle 1ms var(--ease-standard) both;");
    expect(photo).toContain("animation-timeline: --home-creators;");
    const [, photoEnd] = range(photo);
    const [leadFrom, leadTo] = range(rule(".home-scroll .home-creators__lead"));
    expect(leadFrom / photoEnd).toBeGreaterThanOrEqual(0.75);
    expect(leadTo).toBeGreaterThan(photoEnd);

    // Os três retratos: em escada, só opacidade e 12px, inteiros antes de o
    // topo passar de 75% da tela.
    expect(rule(".home-scroll .home-who__photo")).toContain("animation: motion-scroll-fact 1ms var(--ease-standard) both;");
    const portraits = [
      rule(".home-scroll .home-who__photo"),
      rule(".home-scroll .home-who__photo:nth-child(2)"),
      rule(".home-scroll .home-who__photo:nth-child(3)"),
    ].map(range);
    for (let i = 1; i < portraits.length; i += 1) expect(portraits[i][0]).toBeGreaterThan(portraits[i - 1][0]);
    for (const [from, to] of portraits) {
      expect(to).toBeGreaterThan(from);
      expect(to).toBeLessThanOrEqual(25);
    }
  });
});
