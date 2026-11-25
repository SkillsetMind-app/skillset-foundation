import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// The motion contract has three timings (120, 180 and 280ms) and one curve. What
// was left outside it (150, 160, 200, 220ms) in the platform controls
// made neighbors move at different rhythms. Left out on purpose: the
// home motion approved in #576 (hero entrance, card and storefront photo),
// the timings another test already fixes (site header in
// site-frame, sections in reveal-without-js) and the press scale
// (onda-d-motion). jsdom animates nothing: what is proven here is the CSS RULE.
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} not found`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
}

describe("house timings", () => {
  it("every transition-* utility without a duration uses the house timing", () => {
    const theme = block("@theme");
    expect(theme).toContain("--default-transition-duration: var(--duration-base);");
    // The curve of the utilities stays Tailwind's, on purpose: the motion of the
    // public site (home, footer, arrow hovers) was approved that way.
    expect(theme).not.toContain("--default-transition-timing-function");
  });

  // The home motion was approved as it is (#576). A token swap
  // must not shorten it without anyone seeing.
  it("the hero entrance and the storefront photo keep the approved timing and curve", () => {
    expect(block(".hero-copy-rise")).toContain("animation: hero-copy-rise 620ms cubic-bezier(0.2, 0.6, 0.2, 1) both;");
    expect(block(".marketplace-card__media img")).toContain("transform 500ms cubic-bezier(0.2, 0.6, 0.2, 1)");
  });

  // The arrows that rotate on open (language, category) move at the house timing;
  // the language one was at 200ms next to the category one, at 180ms.
  it.each(["i18n/locale-switcher.tsx", "teacher/course-category-select.tsx"])(
    "the %s arrow rotates on the tokens",
    (file) => {
      const source = readFileSync(join(process.cwd(), "src/components", file), "utf8");
      expect(source).toContain("transition-transform duration-[var(--duration-base)] ease-[var(--ease-standard)]");
      expect(source).not.toMatch(/duration-\d+/);
    },
  );

  it.each([
    ".field-input",
    ".platform-nav-section-chevron",
    ".dash-card",
    ".studio-payout-chip",
    // The entrance of the phone drawer (and of the Advisor on the phone) was a loose 200ms.
    ".motion-panel-in",
  ])("%s runs on the tokens, with no stray millisecond value", (selector) => {
    const body = block(selector);
    expect(body).toMatch(/var\(--duration-(base|slow)\) var\(--ease-standard\)/);
    expect(body).not.toMatch(/\d+ms/);
  });
});
