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

  // f0be6ff (05/09) sized the frame by the photo's aspect ratio so it would never
  // crop — and left 439px of empty gradient at 1920px, with the photo sitting
  // like a rectangle on the right ("detached from the canvas", the owner 07/09).
  // The frame is now the hero itself; the image covers and anchors the top, so the
  // head survives the crop and the crop, when there is one, is at the bottom.
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
