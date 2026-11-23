import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Botao desligado nao pode parecer clicavel. jsdom nao tem hover nem layout,
// entao o que se prova aqui e a REGRA do CSS (mesmo desenho de onda-d-motion).
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

const variants = [
  "button-solid",
  "button-outline",
  "button-accent",
  "button-danger",
  "button-solid-light",
  "button-outline-light",
];
const rule = `:is(${variants.map((variant) => `.${variant}`).join(", ")}):is(:disabled, [aria-disabled="true"]) {`;

describe("botao desligado nao reage ao mouse nem ao clique", () => {
  it("fica parado, sem sombra e com o cursor de bloqueado", () => {
    const start = css.indexOf(rule);
    expect(start).toBeGreaterThan(-1);
    const body = css.slice(start, css.indexOf("}", start));
    expect(body).toContain("cursor: not-allowed;");
    expect(body).toContain("transform: none;");
    expect(body).toContain("box-shadow: none;");
  });

  // A regra tem a mesma especificidade dos :hover e :active de cada variante:
  // so vale porque vem depois deles. Mover um deles para baixo dela devolve o
  // botao desligado que sobe e afunda.
  it.each(variants)("vem depois do :hover de .%s e do afundar no clique", (variant) => {
    const start = css.indexOf(rule);
    const hover = css.indexOf(`.${variant}:hover {`);
    expect(hover).toBeGreaterThan(-1);
    expect(start).toBeGreaterThan(hover);
    expect(start).toBeGreaterThan(css.indexOf(".button-solid:active,"));
  });

  // Eram cinco opacidades (30, 40, 50, 60, 70%) escritas em cada chamada.
  it("tem uma opacidade só, na regra central", () => {
    const start = css.indexOf(rule);
    const body = css.slice(start, css.indexOf("}", start));
    expect(body).toContain("opacity: 0.6;");
  });

  // O hover trocava o fundo do botão apagado (navy mais escuro, cinza claro).
  // Cada variante repete o fundo de repouso numa regra de desligado que vem
  // depois do próprio :hover, com a mesma especificidade.
  it.each(variants)("no hover, .%s desligado guarda o fundo de repouso", (variant) => {
    const declaration = (selector: string, prop: string) => {
      const at = css.search(new RegExp(`\\n${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{`));
      expect(at, `${selector} não encontrado`).toBeGreaterThan(-1);
      const body = css.slice(at, css.indexOf("}", at));
      return body.match(new RegExp(`\\s${prop}:\\s*([^;]+);`))?.[1];
    };
    const disabled = `.${variant}:is(:disabled, [aria-disabled="true"])`;
    const resting = declaration(`.${variant}`, "background");
    expect(resting).toBeTruthy();
    expect(declaration(disabled, "background")).toBe(resting);
    expect(css.indexOf(`\n${disabled} {`)).toBeGreaterThan(css.indexOf(`.${variant}:hover {`));
  });

  it("o vermelho cheio de apagar continua vermelho quando desligado", () => {
    const at = css.indexOf('.button-danger.button-danger-solid:is(:disabled, [aria-disabled="true"]) {');
    expect(at).toBeGreaterThan(css.indexOf(".button-danger.button-danger-solid:hover {"));
    expect(css.slice(at, css.indexOf("}", at))).toContain("background: var(--color-danger);");
  });

  // A regra central vence a utility (fica fora de camada), então a utility da
  // chamada só criava a quinta variação. Ela não volta.
  it("nenhum botão .button-* escreve a própria opacidade de desligado", () => {
    const dir = join(process.cwd(), "src");
    // A compra sem conta fica fora deste pacote (caminho de pagamento); os
    // 60% dela já são os da regra central.
    const pending = new Set(["guest-checkout-form.tsx"]);
    const files = readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() &&
          entry.name.endsWith(".tsx") &&
          !entry.name.endsWith(".test.tsx") &&
          !pending.has(entry.name),
      )
      .map((entry) => join(entry.parentPath, entry.name));
    const both =
      /["'`](?=[^"'`]*\bbutton-(?:solid|outline|accent|danger)\b)(?=[^"'`]*\b(?:aria-)?disabled:opacity-\d+)[^"'`]*["'`]/g;
    const violations: string[] = [];
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(both)) {
        violations.push(`${file}: ${match[0]}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
