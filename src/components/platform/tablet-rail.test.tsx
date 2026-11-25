import { renderHook } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useSidebarState } from "@/lib/ui/sidebar-state";

/**
 * On the tablet the navigation was the PHONE one: on a 1000px-wide screen, with
 * plenty of room, the sidebar disappeared and the bottom bar came in. The 64px rail
 * already existed and was only reachable above 1024px.
 *
 * Scan of the CSS because jsdom does not evaluate any media query: `matchMedia`
 * is a stub that always answers `false`, and nothing here has layout. What can be
 * proven is the RULE — in which range each design applies.
 */

const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");

/**
 * ALL the `@media (...) { ... }` blocks of that range, glued together. The same range
 * shows up at several points in the file (the cookie banner and the navigation are
 * two of them); the question that matters is what the range does in total.
 */
function mediaBlocks(query: string): string {
  const marker = `@media ${query} {`;
  const found: string[] = [];
  let cursor = css.indexOf(marker);

  while (cursor > -1) {
    let depth = 0;

    for (let index = css.indexOf("{", cursor); index < css.length; index += 1) {
      if (css[index] === "{") {
        depth += 1;
      } else if (css[index] === "}") {
        depth -= 1;

        if (depth === 0) {
          found.push(css.slice(cursor, index + 1));
          cursor = css.indexOf(marker, index);
          break;
        }
      }
    }
  }

  expect(found.length, `block not found: @media ${query}`).toBeGreaterThan(0);

  return found.join("\n");
}

describe("tablet (768–1023px) uses the rail, not the bottom bar", () => {
  it("the bottom bar and the sidebar's disappearance apply only below 768px", () => {
    const phone = mediaBlocks("(max-width: 767.98px)");

    expect(phone).toContain(".platform-mobile-nav");
    expect(phone).toContain("display: flex");
    expect(phone).toMatch(/\.platform-sidebar \{\s*display: none/);

    // And no 1023px block is left turning on the bottom bar or
    // hiding the sidebar — which was exactly the bug.
    const tabletAndBelow = mediaBlocks("(width < 1024px)");
    expect(tabletAndBelow).not.toContain(".platform-mobile-nav");
    expect(tabletAndBelow).not.toContain(".platform-sidebar {");
  });

  it("from 768 to 1023px the sidebar column is the 64px rail, and the collapse button disappears", () => {
    const tablet = mediaBlocks("(min-width: 768px) and (width < 1024px)");

    expect(tablet).toContain("--platform-sidebar-width: 64px");
    expect(tablet).toMatch(
      /\.platform-sidebar \.platform-sidebar-toggle \{\s*display: none/,
    );
    // The labels must not leak out of 64px while the class has not arrived.
    expect(tablet).toContain(".platform-sidebar-label");
  });

  it("the cookie banner only moves up where the bottom bar actually exists", () => {
    // It moves up 60px so as not to cover the bar. On the tablet there is no bar, and the
    // banner would float with a gap underneath.
    const phone = mediaBlocks("(max-width: 767.98px)");
    expect(phone).toContain("body:has(.platform-mobile-nav) .cookie-consent");
  });

  it("the playlist under the video goes to two columns from 768 to 1180px", () => {
    const strip = mediaBlocks("(min-width: 768px) and (max-width: 1180px)");

    expect(strip).toContain(".member-playlist__lessons");
    expect(strip).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");

    // Below 1180 the whole sidebar was already one column; the new rule must
    // come AFTER it to apply (same specificity, the last one wins).
    expect(css.indexOf("@media (min-width: 768px) and (max-width: 1180px)")).toBeGreaterThan(
      css.indexOf("@media (max-width: 1180px)"),
    );
  });
});

describe("a barra lateral no tablet", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = "skillset_sidebar=; max-age=0; path=/";
  });

  it("in the rail range the bar comes collapsed, writing no preference", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} })),
    );

    const { result } = renderHook(() => useSidebarState());

    expect(result.current.isCollapsed).toBe(true);
    // With no saved choice: the rail is the screen's default, not a stored choice.
    expect(result.current.isAuto).toBe(true);
    expect(document.cookie).toBe("");
  });

  it("from 768 to 1023px the rail applies even to someone who opened the bar", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(min-width: 768px) and (width < 1024px)",
      addEventListener() {},
      removeEventListener() {},
    }));
    document.cookie = "skillset_sidebar=expanded; path=/";

    const { result } = renderHook(() => useSidebarState());

    expect(result.current.isCollapsed).toBe(true);
    expect(result.current.isAuto).toBe(false);
  });

  it("without matchMedia (bare jsdom, old browser) it does not blow up — it falls back to the usual layout", () => {
    // What broke CI: `window.matchMedia is not a function` on three screens
    // that only rendered the shell. Blowing up in jsdom is blowing up in some
    // real browser.
    vi.stubGlobal("matchMedia", undefined);

    const { result } = renderHook(() => useSidebarState());

    expect(result.current.isCollapsed).toBe(false);
  });
});
