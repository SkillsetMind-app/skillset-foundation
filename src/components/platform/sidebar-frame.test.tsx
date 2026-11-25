import { readFileSync } from "node:fs";
import path from "node:path";

import postcss, { type Rule } from "postcss";
import { describe, expect, it } from "vitest";

// Sidebar: only the SELECTED item has a frame. Before, each item had its
// own little box (border + background), and the bar became a pile of rectangles in
// which nothing stood out. The active item keeps its border, background and shadow.
//
// jsdom does not resolve the cascade with !important from a rule outside a layer, so the
// test reads the real globals.css rules.

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
  it("items that are NOT selected have no border and no background", () => {
    const inactive = declarations(
      ".platform-sidebar .platform-nav-link:not(.platform-nav-active)",
    );

    expect(inactive["border-color"]).toMatch(/^transparent/);
    expect(inactive["background"]).toMatch(/^transparent/);
  });

  it("the selected item keeps the frame", () => {
    const active = declarations(".platform-sidebar .platform-nav-active");

    expect(active["border-color"]).toBeDefined();
    expect(active["border-color"]).not.toMatch(/^transparent/);
    expect(active["background"]).toMatch(/rgba\(255, 255, 255/);
  });
});

// The side menu's scrollbar was translucent navy over the navy
// rail: whoever looked could not see that it scrolled. With no color of its own, the
// container inherited the global scrollbar (--color-line-strong).
describe("barra lateral: barra de rolagem visivel sobre o navy", () => {
  const scroller = ".platform-sidebar .platform-sidebar-nav";

  it("the thumb is translucent white, thin and rounded, with a transparent track", () => {
    const thumb = declarations(`${scroller}::-webkit-scrollbar-thumb`);
    expect(thumb["background-color"]).toBe("rgba(255, 255, 255, 0.35)");
    expect(thumb["border-radius"]).toBe("999px");
    // The global bar puts a 2px transparent border: on a 6px bar
    // 2px of thumb would be left over.
    expect(thumb["border"]).toBe("0");

    expect(declarations(`${scroller}::-webkit-scrollbar-thumb:hover`)["background-color"]).toBe(
      "rgba(255, 255, 255, 0.6)",
    );
    expect(declarations(`${scroller}::-webkit-scrollbar`)["width"]).toBe("6px");
    expect(declarations(`${scroller}::-webkit-scrollbar-track`)["background"]).toBe("transparent");
  });

  it("Firefox gets the same color", () => {
    const firefox = declarations(scroller);
    expect(firefox["scrollbar-width"]).toBe("thin");
    expect(firefox["scrollbar-color"]).toBe("rgba(255, 255, 255, 0.35) transparent");
  });

  it("the mobile drawer, which is white, does not inherit the white thumb", () => {
    // The same PlatformNav is rendered in the drawer; only what is inside
    // .platform-sidebar (the navy rail) may turn white.
    expect(declarations(".platform-sidebar-nav")["scrollbar-color"]).toBeUndefined();
  });
});
