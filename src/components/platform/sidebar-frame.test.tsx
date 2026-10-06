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

// A barra de rolagem do menu lateral era azul-marinho translucido sobre o
// trilho navy: quem olhava nao via que dava para rolar. Sem cor propria, o
// contêiner herdava a barra global (--color-line-strong).
describe("barra lateral: barra de rolagem visivel sobre o navy", () => {
  const scroller = ".platform-sidebar .platform-sidebar-nav";

  it("o polegar e branco translucido, fino e arredondado, com trilho transparente", () => {
    const thumb = declarations(`${scroller}::-webkit-scrollbar-thumb`);
    expect(thumb["background-color"]).toBe("rgba(255, 255, 255, 0.35)");
    expect(thumb["border-radius"]).toBe("999px");
    // A barra global poe 2px de borda transparente: numa barra de 6px
    // sobraria 2px de polegar.
    expect(thumb["border"]).toBe("0");

    expect(declarations(`${scroller}::-webkit-scrollbar-thumb:hover`)["background-color"]).toBe(
      "rgba(255, 255, 255, 0.6)",
    );
    expect(declarations(`${scroller}::-webkit-scrollbar`)["width"]).toBe("6px");
    expect(declarations(`${scroller}::-webkit-scrollbar-track`)["background"]).toBe("transparent");
  });

  it("o Firefox recebe a mesma cor", () => {
    const firefox = declarations(scroller);
    expect(firefox["scrollbar-width"]).toBe("thin");
    expect(firefox["scrollbar-color"]).toBe("rgba(255, 255, 255, 0.35) transparent");
  });

  it("a gaveta mobile, que e branca, nao herda o polegar branco", () => {
    // O mesmo PlatformNav e renderizado na gaveta; so o que esta dentro de
    // .platform-sidebar (o trilho navy) pode ficar branco.
    expect(declarations(".platform-sidebar-nav")["scrollbar-color"]).toBeUndefined();
  });
});
