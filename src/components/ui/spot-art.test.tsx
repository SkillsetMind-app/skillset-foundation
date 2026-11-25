import { render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SpotArt, spotArtScenes } from "@/components/ui/spot-art";

// The drawing rules that can be measured in code: hidden from the screen
// reader, light for a bad connection, no network, and one brass per scene.
describe.each(spotArtScenes)("the %s scene", (scene) => {
  it.each(["default", "light"] as const)("renders hidden from the screen reader and under 3 KB (%s)", (tone) => {
    const { container } = render(<SpotArt scene={scene} tone={tone} />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("focusable", "false");

    const markup = renderToStaticMarkup(<SpotArt scene={scene} tone={tone} />);
    expect(new TextEncoder().encode(markup).length).toBeLessThan(3 * 1024);
  });

  it("downloads nothing: no image, no link, no drawn number", () => {
    const markup = renderToStaticMarkup(<SpotArt scene={scene} />);
    expect(markup).not.toMatch(/<image|<text|<use|href=|url\(/);
  });

  // The receipt goes in the revenue chart, where solid brass is forbidden: only light
  // brass. The other scenes have exactly one.
  it(`has ${scene === "noSales" ? "zero elementos" : "um único elemento"} in solid brass`, () => {
    const markup = renderToStaticMarkup(<SpotArt scene={scene} />);
    expect(markup.match(/var\(--art-brass\)/g) ?? []).toHaveLength(scene === "noSales" ? 0 : 1);
  });

  it("the engraving stays between 15% and 35% opacity", () => {
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
