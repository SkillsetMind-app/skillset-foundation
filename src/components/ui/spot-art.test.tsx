import { render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SpotArt, spotArtScenes } from "@/components/ui/spot-art";

// As regras do desenho que dá para medir no código: escondida do leitor de
// tela, leve para internet ruim, sem rede, e um latão só por cena.
describe.each(spotArtScenes)("a cena %s", (scene) => {
  it.each(["default", "light"] as const)("sai escondida do leitor de tela e com menos de 3 KB (%s)", (tone) => {
    const { container } = render(<SpotArt scene={scene} tone={tone} />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("focusable", "false");

    const markup = renderToStaticMarkup(<SpotArt scene={scene} tone={tone} />);
    expect(new TextEncoder().encode(markup).length).toBeLessThan(3 * 1024);
  });

  it("não baixa nada: sem imagem, sem link, sem número desenhado", () => {
    const markup = renderToStaticMarkup(<SpotArt scene={scene} />);
    expect(markup).not.toMatch(/<image|<text|<use|href=|url\(/);
  });

  it("tem um único elemento em latão", () => {
    const markup = renderToStaticMarkup(<SpotArt scene={scene} />);
    expect(markup.match(/var\(--art-brass\)/g)).toHaveLength(1);
  });

  it("a gravura fica entre 15% e 35% de opacidade", () => {
    const { container } = render(<SpotArt scene={scene} />);
    const engraving = [...container.querySelectorAll(".spot-art__engraving")];
    expect(engraving.length).toBeGreaterThan(0);
    for (const node of engraving) {
      const opacity = Number(node.getAttribute("opacity"));
      expect(opacity).toBeGreaterThanOrEqual(0.15);
      expect(opacity).toBeLessThanOrEqual(0.35);
    }
  });
});
