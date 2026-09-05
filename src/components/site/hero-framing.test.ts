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

  it("fits the desktop portrait to the full hero height without cropping its head", () => {
    const declarations: Record<string, string> = {};
    css.walkRules(".hero-portrait-frame", (rule) => {
      rule.walkDecls((decl) => { declarations[decl.prop] = decl.value; });
    });
    expect(declarations.height).toBe("100%");
    expect(declarations["aspect-ratio"]).toBe("1672 / 941");
    expect(declarations.width).toBe("auto");
    expect(declarations.right).toBe("0");
  });
});
