import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import postcss from "postcss";

const css = postcss.parse(readFileSync("src/app/globals.css", "utf8"));

describe("hero portrait framing", () => {
  it("never translates the photo away from the hero edges", () => {
    css.walkRules(".hero-portrait-image", (rule) => {
      rule.walkDecls("transform", (decl) => expect(decl.value).toBe("none"));
    });
  });

  // f0be6ff (05/09) dimensionava o quadro pela proporcao da foto para nunca
  // cortar — e deixava 439px de gradiente vazio a 1920px, com a foto parada
  // como um retangulo a direita ("desencaixada do canvas", Patrick 07/09).
  // O quadro agora e o proprio hero; a imagem cobre e ancora o topo, entao a
  // cabeca sobrevive ao corte e o corte, quando ha, e embaixo.
  it("covers the whole desktop hero instead of standing as a photo-shaped box on the right", () => {
    const declarations: Record<string, string> = {};
    css.walkRules(".hero-portrait-frame", (rule) => {
      rule.walkDecls((decl) => { declarations[decl.prop] = decl.value; });
    });
    expect(declarations["aspect-ratio"]).toBeUndefined();
    expect(declarations.width).toBeUndefined();

    const hero = readFileSync("src/components/site/marketing-hero.tsx", "utf8");
    expect(hero).toMatch(/hero-portrait-frame[^"]*\bw-full\b/);
    expect(hero).toMatch(/hero-portrait-image[^"]*\blg:object-\[center_top\]/);
  });
});
