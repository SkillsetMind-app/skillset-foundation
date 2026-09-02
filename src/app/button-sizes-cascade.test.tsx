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
  "button-solid button-outline button-danger text-xs text-sm py-2 py-2.5 px-3.5 text-[var(--color-accent-fg)] focus-visible:outline-[var(--focus-ring)] focus-visible:ring-[var(--focus-ring)]";

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
// pseudo-classes, elementos.
function specificity(selector: string): number {
  const ids = (selector.match(/#[\w-]+/g) ?? []).length;
  const classes = (selector.match(/\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+/g) ?? []).length;
  const tags = (selector.match(/(^|[\s>+~(])[a-z][\w-]*/g) ?? []).length;
  return ids * 100 + classes * 10 + tags;
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

function collect(css: Root, element: Element, props: Set<string>): Candidate[] {
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
        return element.matches(selector);
      } catch {
        return false;
      }
    });
    if (!matches) return;

    const bestSelector = Math.max(
      ...rule.selectors.map((selector) => {
        try {
          return element.matches(selector) ? specificity(selector) : -1;
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
  const candidates = collect(css, element, new Set(props));
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

function mount(className: string): Element {
  const button = document.createElement("button");
  button.className = className;
  document.body.append(button);
  return button;
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
