// @vitest-environment node
//
// A source-level guard, not a render test. jsdom has no layout, so it cannot
// catch a panel taller than the screen — but the mistake is structural and
// greppable, and this is the only kind of test that stops it coming back in a
// component nobody thought to write a test for.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = join(process.cwd(), "src", "components");

// Overlays that are deliberately full-height and are not dialogs: a slide-in
// drawer and a dropdown menu anchored under the header. Capping those would be
// wrong, so they are named here rather than silently skipped by a loose rule.
const NOT_DIALOGS = new Set([
  "platform/mobile-sidebar-drawer.tsx",
  "site/site-nav.tsx",
]);

function everyComponent(dir: string, prefix = ""): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    const rel = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(full).isDirectory()) return everyComponent(full, rel);
    return entry.endsWith(".tsx") && !entry.includes(".test.") ? [rel] : [];
  });
}

describe("centred dialogs fit the viewport", () => {
  it("caps every centred overlay panel", () => {
    const offenders = everyComponent(ROOT).filter((rel) => {
      if (NOT_DIALOGS.has(rel)) return false;
      const source = readFileSync(join(ROOT, rel), "utf8");
      const isOverlay = source.includes("fixed inset-0");
      const isCentred =
        source.includes("items-center") || source.includes("place-items-center");
      // Either the shared rule or a cap of its own. lesson-list-overlay sets
      // sm:max-h-[86vh] and scrolls inside, which is correct — the requirement
      // is that the panel is bounded, not that it uses one particular class.
      const isCapped =
        source.includes("modal-panel") || source.includes("max-h-");
      return isOverlay && isCentred && !isCapped;
    });

    // A centred panel with no height cap overflows above AND below the screen,
    // and the top half is unreachable — its buttons go with it. Measured once
    // on /pricing: 1516px of panel in a 672px window, confirm button at y=1050.
    expect(
      offenders,
      `These centred overlays have no height cap. Add "modal-panel" to the panel (plus "modal-panel-scroll" if it has no inner scroll region), or list it in NOT_DIALOGS if it is a drawer or a menu:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("keeps the rule itself in the stylesheet", () => {
    // The class is what every panel above points at. If it is ever deleted the
    // components go quiet rather than failing, so the rule is asserted too.
    const css = readFileSync(
      join(process.cwd(), "src", "app", "globals.css"),
      "utf8",
    );
    expect(css).toContain(".modal-panel {");
    expect(css).toContain("max-height: 100svh");
    expect(css).toContain(".modal-panel-scroll {");
  });
});
