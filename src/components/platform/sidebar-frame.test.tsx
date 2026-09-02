import { readFileSync } from "node:fs";
import path from "node:path";

import postcss, { type Rule } from "postcss";
import { describe, expect, it } from "vitest";

// Barra lateral: so o item SELECIONADO tem moldura. Antes, cada item tinha a
// sua caixinha (borda + fundo), e a barra virava uma pilha de retangulos em
// que nada se destacava. O item ativo continua com borda, fundo e sombra.
//
// jsdom nao resolve cascata com !important de regra fora de camada, entao o
// teste le as regras do globals.css de verdade.

const css = postcss.parse(
  readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8"),
);

function declarations(selector: string): Record<string, string> {
  const found: Record<string, string> = {};
  css.walkRules((rule: Rule) => {
    if (rule.selector.replace(/\s+/g, " ").trim() !== selector) {
      return;
    }
    rule.walkDecls((decl) => {
      found[decl.prop] = decl.value;
    });
  });
  return found;
}

describe("barra lateral: moldura so no item selecionado", () => {
  it("os itens que NAO estao selecionados ficam sem borda e sem fundo", () => {
    const inactive = declarations(
      ".platform-sidebar .platform-nav-link:not(.platform-nav-active)",
    );

    expect(inactive["border-color"]).toMatch(/^transparent/);
    expect(inactive["background"]).toMatch(/^transparent/);
  });

  it("o item selecionado continua com a moldura", () => {
    const active = declarations(".platform-sidebar .platform-nav-active");

    expect(active["border-color"]).toBeDefined();
    expect(active["border-color"]).not.toMatch(/^transparent/);
    expect(active["background"]).toMatch(/rgba\(255, 255, 255/);
  });
});
