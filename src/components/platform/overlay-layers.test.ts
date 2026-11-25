import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

// The platform sidebar sits at z-index 65 (above the topbar, 60).
// A full-screen dialog below that shows up with the start of the lines
// hidden behind the bar: that is what happened with the terms notice (z-50)
// and with the welcome tours (z-60). The public site has no sidebar.
const root = join(process.cwd(), "src", "components");
const PUBLIC_SITE = "site";

const sidebarZ = (() => {
  const css = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");
  const block = css.match(/^\.platform-sidebar \{([\s\S]*?)^\}/m)?.[1] ?? "";
  return Number(block.match(/z-index:\s*(\d+)/)?.[1]);
})();

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.name.endsWith(".tsx") && !entry.name.includes(".test.") ? [path] : [];
  });
}

describe("layers of the full-screen dialogs", () => {
  it("lê o z-index da barra lateral no CSS", () => {
    expect(sidebarZ).toBeGreaterThan(0);
  });

  const overlays = tsxFiles(root)
    .filter((file) => relative(root, file).split(/[\\/]/)[0] !== PUBLIC_SITE)
    .flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/fixed inset-0 z-(?:\[(\d+)\]|(\d+))/g)].map(
        (m) => [relative(root, file), Number(m[1] ?? m[2])] as const,
      ),
    );

  // An empty list becomes zero tests and passes silently: the class pattern changed.
  it("finds the full-screen dialogs", () => {
    expect(overlays.length).toBeGreaterThan(0);
  });

  it.each(overlays)("%s sits above the sidebar (z %i)", (_, z) => {
    expect(z).toBeGreaterThan(sidebarZ);
  });
});

// The test above only reads "fixed inset-0 z-" written in the component. Left
// out were the layers made by a CSS class (lesson studio, community
// drawer, "Draft saved" strip) and what does not cover the whole screen, like
// the video upload card, which at z 90 sat above every dialog.
// Here the named scale in :root is the ruler, and each layer is read from the CSS.
describe("named layer scale", () => {
  // Without comments: the one at the top cites "z-index: 1" in the middle of the text.
  const css = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rootBlock = css.slice(css.indexOf(":root {"), css.indexOf("\n}", css.indexOf(":root {")));
  const layers: Record<string, number> = Object.fromEntries(
    [...rootBlock.matchAll(/--z-([a-z-]+):\s*(\d+);/g)].map((m) => [m[1], Number(m[2])]),
  );

  // z-index of the selector's 1st rule; accepts a number or var(--z-...).
  function zOf(selector: string): number {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const body = css.match(new RegExp(`^\\s*${escaped} \\{([^}]*)\\}`, "m"))?.[1] ?? "";
    const value = body.match(/z-index:\s*([^;]+);/)?.[1]?.trim() ?? "";
    const named = value.match(/^var\(--z-([a-z-]+)\)$/)?.[1];
    return named ? layers[named] : Number(value);
  }

  it("reads the scale in :root, from bottom to top", () => {
    const order = ["dropdown", "topbar", "rail", "status", "float", "banner", "modal", "modal-studio", "modal-top", "tooltip"];
    const values = order.map((name) => layers[name]);
    expect(values.every((value) => Number.isFinite(value))).toBe(true);
    expect([...values].sort((a, b) => a - b)).toEqual(values);
  });

  it.each([
    [".platform-topbar", "topbar"],
    [".platform-sidebar", "rail"],
    [".floating-action", "float"],
    [".created-strip", "status"],
    [".cookie-consent", "banner"],
    [".community-drawer-backdrop", "modal"],
    [".lesson-modal-overlay", "modal-studio"],
  ])("%s is on layer %s", (selector, layer) => {
    expect(zOf(selector)).toBe(layers[layer]);
  });

  it("the sidebar read by the test above is the same one in the scale", () => {
    expect(sidebarZ).toBe(layers.rail);
  });

  // Progress notices do not cover what the person is using: on a phone the
  // uploaded card sat on top of the Advisor message box (68) and the
  // category menu (67), and the strip covered the menu for 4s.
  it("the status layer sits above the side menu and below the category menu and the Advisor", () => {
    expect(layers.status).toBeGreaterThan(layers.rail);
    expect(layers.status).toBeLessThan(zOf(".course-category-menu"));
    expect(layers.status).toBeLessThan(zOf(".floating-action"));
  });

  it("the video upload card sits on the status layer, below every dialog", () => {
    const source = readFileSync(join(root, "teacher", "lesson-upload-provider.tsx"), "utf8");
    const named = source.match(/<aside[^>]*className="[^"]*\bfixed\b[^"]*\bz-\[var\(--z-([a-z-]+)\)\]/)?.[1];
    expect(named).toBe("status");
    expect(layers.status).toBeLessThan(layers.modal);
    // On a phone it rises above the bottom bar, like the cookie notice, and
    // the cap discounts the rise so the top does not leave the screen.
    expect(source).toContain("lesson-upload-card");
    const lifted = css.match(/body:has\(\.platform-mobile-nav\) \.lesson-upload-card \{([^}]*)\}/)?.[1] ?? "";
    expect(lifted).toContain("bottom: calc(60px + 1rem + env(safe-area-inset-bottom, 0px));");
    expect(lifted).toContain("max-height: calc(100svh - 60px - 2rem - env(safe-area-inset-bottom, 0px));");
  });
});
