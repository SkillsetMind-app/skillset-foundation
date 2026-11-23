import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import tailwindcss from "@tailwindcss/postcss";
import postcss, { type Root } from "postcss";
import { beforeAll, describe, expect, it } from "vitest";

// jsdom não resolve cascata de folhas de estilo (muito menos @layer), então o
// que este arquivo faz é: compilar o globals.css REAL pelo mesmo pipeline do
// build (PostCSS + @tailwindcss/postcss) e resolver a cascata dos botões de
// prova à mão, seguindo a spec — camada, !important, especificidade, ordem.
// Foi exatamente assim que a auditoria mediu o defeito (P-16): a regra base
// dos botões fora de camada vencia toda utility de tamanho, e 287 botões que
// pediam text-xs/text-sm/py-2/py-2.5 saíam idênticos.

const root = process.cwd();
const globalsPath = join(root, "src/app/globals.css");

const PROBE_CLASSES =
  "button-solid button-outline button-danger button-solid-light button-outline-light text-xs text-sm font-semibold font-normal py-2 py-2.5 px-3.5 text-[var(--color-accent-fg)] focus-visible:outline-[var(--focus-ring)] focus-visible:ring-[var(--focus-ring)] disabled:opacity-40 field-input min-h-[88px] transition-colors text-[var(--color-primary)]!";

async function compileGlobals(): Promise<Root> {
  // Só troca a varredura de arquivos por uma lista fixa de classes: o resto
  // do globals.css entra inteiro, como no build.
  const source = readFileSync(globalsPath, "utf8").replace(
    '@import "tailwindcss";',
    `@import "tailwindcss" source(none);\n@source inline("${PROBE_CLASSES}");`,
  );
  const result = await postcss([tailwindcss()]).process(source, { from: globalsPath });
  return postcss.parse(result.css);
}

type Candidate = {
  value: string;
  important: boolean;
  layer: number;
  specificity: number;
  order: number;
};

// Aproximação suficiente para os seletores de botão: ids, classes/atributos/
// pseudo-classes, elementos. `:is()`/`:not()` valem o argumento mais pesado e
// `:where()` vale zero, como na spec: contar `:is(.a, .b):is(:disabled, [x])`
// como cinco classes fazia a regra de desligado vencer onde não vence.
function specificity(selector: string): number {
  let nested = 0;
  const flat = selector.replace(/:(is|not|where)\(([^()]*)\)/g, (_match, fn: string, args: string) => {
    if (fn !== "where") nested += Math.max(...args.split(",").map((arg) => specificity(arg.trim())));
    return "";
  });
  const ids = (flat.match(/#[\w-]+/g) ?? []).length;
  const classes = (flat.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) ?? []).length;
  const tags = (flat.match(/(^|[\s>+~(])[a-z][\w-]*/g) ?? []).length;
  return ids * 100 + classes * 10 + tags + nested;
}

function readLayerOrder(css: Root): string[] {
  let order: string[] = [];
  css.walkAtRules("layer", (atRule) => {
    if (!atRule.nodes && atRule.params.includes(",") && order.length === 0) {
      order = atRule.params.split(",").map((name) => name.trim());
    }
  });
  return order;
}

// O `:is()` com lista não é confiável no motor de seletores do jsdom: abre a
// lista em seletores simples (`:is(.a, .b):is(:x, [y])` vira quatro) e casa
// qualquer um. A especificidade segue sendo a do seletor original.
function expandIs(selector: string): string[] {
  const match = /:is\(([^()]*)\)/.exec(selector);
  if (!match) return [selector];
  const before = selector.slice(0, match.index);
  const after = selector.slice(match.index + match[0].length);
  return match[1].split(",").flatMap((arg) => expandIs(`${before}${arg.trim()}${after}`));
}

// `hover`: trata o elemento como se o mouse estivesse em cima (o seletor casa
// sem o `:hover`, mas a especificidade conta o `:hover`).
function collect(css: Root, element: Element, props: Set<string>, hover = false): Candidate[] {
  const matchesAs = (selector: string) =>
    expandIs(hover ? selector.replace(/:hover/g, "") : selector).some((simple) => element.matches(simple));
  const layerOrder = readLayerOrder(css);
  const unlayered = layerOrder.length;
  const candidates: Candidate[] = [];
  let order = 0;

  css.walkRules((rule) => {
    let layer = unlayered;
    let skip = false;
    for (let parent = rule.parent; parent && parent.type !== "root"; parent = parent.parent) {
      if (parent.type !== "atrule") continue;
      const name = (parent as postcss.AtRule).name;
      if (name === "layer") {
        layer = layerOrder.indexOf((parent as postcss.AtRule).params.trim());
      } else {
        // @media, @supports, @container: fora do que o botão de prova vive.
        skip = true;
      }
    }
    if (skip) return;

    const matches = rule.selectors.some((selector) => {
      try {
        return matchesAs(selector);
      } catch {
        return false;
      }
    });
    if (!matches) return;

    const bestSelector = Math.max(
      ...rule.selectors.map((selector) => {
        try {
          return matchesAs(selector) ? specificity(selector) : -1;
        } catch {
          return -1;
        }
      }),
    );

    rule.walkDecls((decl) => {
      if (!props.has(decl.prop)) return;
      order += 1;
      candidates.push({
        value: decl.value,
        important: decl.important,
        layer,
        specificity: bestSelector,
        order,
      });
    });
  });

  return candidates;
}

// CSS Cascade 5: !important vence normal; entre normais, sem-camada vence e
// depois a camada mais TARDIA; entre importantes a ordem inverte (camada mais
// cedo vence, sem-camada perde de todas); então especificidade, então ordem.
function resolve(css: Root, element: Element, ...props: string[]): string | undefined {
  return pick(css, collect(css, element, new Set(props)));
}

function resolveHover(css: Root, element: Element, ...props: string[]): string | undefined {
  return pick(css, collect(css, element, new Set(props), true));
}

function pick(css: Root, candidates: Candidate[]): string | undefined {
  const unlayered = readLayerOrder(css).length;
  const key = (candidate: Candidate) => [
    candidate.important ? 1 : 0,
    candidate.important
      ? candidate.layer === unlayered
        ? -Infinity
        : -candidate.layer
      : candidate.layer,
    candidate.specificity,
    candidate.order,
  ];
  const winner = [...candidates].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let index = 0; index < ka.length; index += 1) {
      if (ka[index] !== kb[index]) return ka[index] - kb[index];
    }
    return 0;
  }).at(-1);
  return winner?.value;
}

let css: Root;

beforeAll(async () => {
  css = await compileGlobals();
}, 60_000);

function mount(className: string, tag = "button"): Element {
  const element = document.createElement(tag);
  element.className = className;
  document.body.append(element);
  return element;
}

describe("tamanho dos botões (P-16)", () => {
  it("dois botões que pedem tamanhos diferentes saem diferentes", () => {
    const small = mount("button-solid px-3.5 py-2 text-xs");
    const large = mount("button-solid px-3.5 py-2.5 text-sm");

    const smallFont = resolve(css, small, "font-size");
    const largeFont = resolve(css, large, "font-size");
    expect(smallFont).toBeDefined();
    expect(smallFont).not.toBe(largeFont);
    // O valor único que a regra base impunha a todos os 287 botões.
    expect(smallFont).not.toBe("0.84375rem");
    expect(largeFont).not.toBe("0.84375rem");

    const smallPadding = resolve(css, small, "padding", "padding-block", "padding-top");
    const largePadding = resolve(css, large, "padding", "padding-block", "padding-top");
    expect(smallPadding).not.toBe(largePadding);
    expect(smallPadding).not.toBe("0.75rem 1.25rem");
  });

  it("o alvo mínimo de 44px continua valendo quando ninguém pede outra altura", () => {
    const button = mount("button-outline px-3.5 py-2 text-xs");
    expect(resolve(css, button, "min-height")).toBe("44px");
  });

  // A ação principal da criação de produto (Continuar, Criar, Publicar). O
  // 48px, 15px e peso 600 (decisão do fundador: primária sólida, mais alta,
  // 600). Antes um `button { font: inherit }` sem camada vencia a camada
  // `components` e o .button-lg precisava morar fora dela com 800.
  it("o par grande sai com 48px e 15px/600 num <button>", () => {
    const primary = mount("button-solid button-lg");
    const secondary = mount("button-outline button-lg");

    expect(resolve(css, primary, "min-height")).toBe("48px");
    expect(resolve(css, primary, "font-weight", "font")).toBe("600");
    expect(resolve(css, primary, "font-size", "font")).toBe("0.9375rem");
    expect(resolve(css, secondary, "min-height")).toBe("48px");
    expect(resolve(css, secondary, "font-weight", "font")).toBe("600");
    expect(resolve(css, secondary, "border-color")).toBe("var(--color-primary)");
  });

  // A regra `button, input, textarea, select { font: inherit }` fora de camada
  // fazia TODO <button> sair 16px/400 e todo campo ignorar text-sm/font-normal.
  // O `font: inherit` agora vem só do preflight (camada base).
  it("um <button> .button-solid sai 14px/600, não a letra herdada", () => {
    const button = mount("button-solid");

    expect(resolve(css, button, "font-size", "font")).toBe("0.875rem");
    expect(resolve(css, button, "font-weight", "font")).toBe("600");
  });

  it("utilities de letra valem em <button> e em campo", () => {
    const button = mount("text-sm font-semibold");
    const input = mount("text-sm font-normal", "input");

    expect(resolve(css, button, "font-size", "font")).toContain("--text-sm");
    expect(resolve(css, button, "font-weight", "font")).toContain("--font-weight-semibold");
    expect(resolve(css, input, "font-size", "font")).toContain("--text-sm");
    expect(resolve(css, input, "font-weight", "font")).toContain("--font-weight-normal");
  });

  // As variantes claras do hero viviam num bloco próprio, sem min-height:
  // padding 10 + linha 20 + borda 2 = 42px no celular e no tablet (QA 07/09).
  it("as variantes claras (hero) guardam os mesmos 44px", () => {
    expect(resolve(css, mount("button-solid-light"), "min-height")).toBe("44px");
    expect(resolve(css, mount("button-outline-light"), "min-height")).toBe("44px");
  });

  it("nenhuma variante de botão rebaixa o alvo de 44px para 36px ou 40px", () => {
    const dir = join(root, "src");
    const files = readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() && entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx"),
      )
      .map((entry) => join(entry.parentPath, entry.name));
    const undersizedButton =
      /className\s*=\s*(?:\{\s*)?["'`][^"'`]*(?=[^"'`]*\bbutton-(?:solid|outline|accent|danger)\b)(?=[^"'`]*\bmin-h-(?:9|10)\b)[^"'`]*["'`]/g;
    const violations: string[] = [];

    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(undersizedButton)) {
        const line = source.slice(0, match.index).split("\n").length;
        violations.push(`${file}:${line}: ${match[0]}`);
      }
    }
    expect(violations).toEqual([]);
  });

  // F18: sobraram 12 alvos (abas, selects, botoes de texto) em min-h-9/min-h-10
  // fora das variantes button-*. A regra e a mesma para qualquer alvo de toque.
  it("nenhum alvo em src/components pede min-h-9 ou min-h-10 (36/40px)", () => {
    const dir = join(root, "src/components");
    const files = readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() && entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx"),
      )
      .map((entry) => join(entry.parentPath, entry.name));
    const violations: string[] = [];

    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/\bmin-h-(?:9|10)\b/g)) {
        const line = source.slice(0, match.index).split("\n").length;
        violations.push(`${file}:${line}`);
      }
    }
    expect(violations).toEqual([]);
  });
});

// C-11: a opacidade de desligado vinha de cada chamada, em cinco valores. A
// regra central fica fora de camada e vence a utility, então a chamada que
// ainda pede 40% sai com os mesmos 60% de todo botão desligado.
describe("botão desligado (C-11)", () => {
  it("sai com 60% e o fundo de repouso, mesmo pedindo outra opacidade", () => {
    const button = mount("button-solid disabled:opacity-40");
    button.setAttribute("disabled", "");
    expect(resolve(css, button, "opacity")).toBe("0.6");
    expect(resolve(css, button, "background")).toBe("var(--color-primary)");
  });

  function disabled(className: string, wrapper?: Record<string, string>, off = true): Element {
    const button = mount(className);
    if (off) button.setAttribute("disabled", "");
    if (wrapper) {
      const box = document.createElement("div");
      for (const [name, value] of Object.entries(wrapper)) box.setAttribute(name, value);
      document.body.append(box);
      box.append(button);
    }
    return button;
  }

  // Cada caso: o botão desligado tem, em repouso e com o mouse em cima, o
  // mesmo desenho do botão ligado em repouso (no mesmo tema e escopo).
  const member = { class: "member-classroom", "data-members-theme": "light" };
  it.each([
    ["button-solid", undefined, "background"],
    ["button-outline", undefined, "background"],
    // O par grande: o :hover dele (dois seletores de classe) vencia a regra
    // de desligado e o "Back" apagado ia de cinza a navy.
    ["button-outline button-lg", undefined, "border-color"],
    // No escuro, a borda de repouso do tema escuro, não a do claro.
    ["button-danger", { "data-theme": "dark" }, "border-color"],
    ["button-outline", { "data-theme": "dark" }, "border-color"],
    // O rótulo do contorno: o :hover troca para o navy escuro com !important.
    ["button-outline", undefined, "color"],
    ["button-outline", { "data-theme": "dark" }, "color"],
    ["button-danger button-danger-solid", undefined, "background"],
    // Área de membros: as regras do escopo pesam mais que a central.
    ["button-solid", member, "background"],
    ["button-outline", member, "border-color"],
    ["button-icon", undefined, "color"],
  ] as const)("%s desligado (%o): %s de repouso, também no hover", (className, wrapper, prop) => {
    const props = prop === "background" ? ["background", "background-color"] : [prop];
    const resting = resolve(css, disabled(className, wrapper, false), ...props);
    expect(resting).toBeTruthy();
    const button = disabled(className, wrapper);
    expect(resolve(css, button, ...props)).toBe(resting);
    expect(resolveHover(css, button, ...props)).toBe(resting);
  });

  // Prova de que o hover forçado funciona: o botão LIGADO muda.
  it("ligado, o hover forçado escurece o fundo", () => {
    const button = disabled("button-solid", undefined, false);
    expect(resolveHover(css, button, "background")).toBe("var(--color-primary-dark)");
  });

  it("na área de membros o desligado não ganha sombra nem sobe no hover", () => {
    const button = disabled("button-solid", { class: "member-classroom", "data-members-theme": "light" });
    expect(resolveHover(css, button, "box-shadow")).toBe("none");
    expect(resolveHover(css, button, "transform")).toBe("none");
  });

  it("o botão só de ícone desligado tem o cursor de bloqueado e os 60%", () => {
    const button = disabled("button-icon");
    expect(resolve(css, button, "cursor")).toBe("not-allowed");
    expect(resolve(css, button, "opacity")).toBe("0.6");
  });
});

// C-05: 44px em todo campo, a altura do botão ao lado; mas um min-h-* do JSX
// (as caixas de texto de 88px da comunidade) continua valendo.
describe("altura dos campos (C-05)", () => {
  it("um campo .field-input tem no mínimo 44px", () => {
    expect(resolve(css, mount("field-input", "input"), "min-height")).toBe("44px");
  });

  it("a caixa de texto que pede 88px continua com 88px", () => {
    expect(resolve(css, mount("field-input min-h-[88px]", "textarea"), "min-height")).toBe("88px");
  });
});

// C-09: 118 transições escritas à mão (`transition-colors` sem duração)
// rodavam nos 150ms e na curva do Tailwind, ao lado de botões a 180ms.
describe("tempo das transições (C-09)", () => {
  it("uma utility transition-* sem duração usa os tokens de movimento", () => {
    const element = mount("transition-colors");
    expect(resolve(css, element, "transition-duration")).toContain("var(--default-transition-duration)");
    expect(resolve(css, element, "transition-timing-function")).toContain(
      "var(--default-transition-timing-function)",
    );
    expect(resolve(css, document.documentElement, "--default-transition-duration")).toBe("var(--duration-base)");
    // A curva fica a do Tailwind (movimento do site público aprovado assim).
    expect(resolve(css, document.documentElement, "--default-transition-timing-function")).toBe(
      "cubic-bezier(0.4, 0, 0.2, 1)",
    );
  });
});

// `a { color: inherit; text-decoration: none; }` mora FORA de camada e vence
// toda utility do Tailwind: um link que pede a cor de destaque herda a do pai
// (o texto apagado em volta). Só o modificador `!` passa por cima.
describe("cor de link", () => {
  it("num <a>, a utility de cor sem ! herda; com ! sai com a cor pedida", () => {
    expect(resolve(css, mount("text-[var(--color-accent-fg)]", "a"), "color")).toBe("inherit");
    expect(resolve(css, mount("text-[var(--color-primary)]!", "a"), "color")).toBe("var(--color-primary)");
  });
});

describe("anel de foco (F19)", () => {
  // `outline-[var(--x)]` é ambíguo para o Tailwind (largura ou cor?). A prova é
  // o CSS compilado: o token tem de virar cor, nas duas utilities.
  it("`focus-visible:outline-[var(--focus-ring)]` e `ring-[...]` compilam como cor", () => {
    const compiled = css.toString();
    expect(compiled).toContain("outline-color: var(--focus-ring)");
    expect(compiled).toContain("--tw-ring-color: var(--focus-ring)");
  });
});

describe("botão de perigo (P-08)", () => {
  it("`.button-danger` pinta o texto com a tinta de perigo", () => {
    const button = mount("button-danger px-3.5 py-2 text-xs");
    expect(resolve(css, button, "color")).toBe("var(--color-danger-fg)");
  });

  // A causa: o padrão antigo (outline + utility de cor) nunca chegou à tela.
  it("uma utility de cor sobre `.button-outline` continua morta — por isso a variante existe", () => {
    const button = mount("button-outline px-3.5 py-2 text-xs text-[var(--color-accent-fg)]");
    expect(resolve(css, button, "color")).toBe("var(--color-primary)");
  });

  it("nenhum botão outline tenta pintar perigo com utility", () => {
    const dir = join(root, "src");
    // Testes (este inclusive) citam o padrão morto de propósito.
    const files = readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() && entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx"),
      )
      .map((entry) => join(entry.parentPath, entry.name));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(
        /button-outline[^"'`]*text-\[var\(--color-(accent|danger)-fg\)\]/,
      );
    }
  });
});
