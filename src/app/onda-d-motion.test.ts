import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// The motion catalog only exists in the CSS: jsdom animates nothing, so what is
// proven here is the RULE. Same design as classroom-motion.test.ts.
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

/** Ranges [start, end) of each `@media (prefers-reduced-motion: no-preference)`. */
function noPreferenceRanges(): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const opener = "@media (prefers-reduced-motion: no-preference) {";
  let from = css.indexOf(opener);
  while (from !== -1) {
    let depth = 0;
    let end = from + opener.length - 1;
    for (; end < css.length; end += 1) {
      if (css[end] === "{") depth += 1;
      if (css[end] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    ranges.push([from, end]);
    from = css.indexOf(opener, end);
  }
  return ranges;
}

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} not found in globals.css`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
}

describe("motion catalog: tokens", () => {
  it("adds the seal's overshoot and the ceiling of a celebration", () => {
    expect(css).toContain("--ease-pop: cubic-bezier(0.34, 1.56, 0.64, 1);");
    expect(css).toContain("--duration-celebrate: 600ms;");
  });
});

describe("motion catalog: reduced motion turns everything off", () => {
  const ranges = noPreferenceRanges();
  const inside = (index: number) => ranges.some(([start, end]) => index > start && index < end);

  it("every animation in the catalog lives inside no-preference", () => {
    const uses = [...css.matchAll(/animation:\s*motion-[a-z-]+/g)];
    // 1 step change, 2 choice, 4 saved, 5 check and line, 6 seal,
    // 7 strip, 8 stamp/engraving/diamonds, 10 empty-state scene.
    expect(uses.length).toBeGreaterThanOrEqual(10);
    for (const use of uses) {
      expect(inside(use.index!), `outside no-preference: ${use[0]}`).toBe(true);
    }
  });

  it("the check only turns dashed in order to draw itself; without animation it starts whole", () => {
    const dash = css.indexOf("stroke-dasharray: 1;");
    expect(dash).toBeGreaterThan(-1);
    expect(inside(dash)).toBe(true);
  });

  it("the global reduced-motion block still zeroes out animation and transition", () => {
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/animation-duration: 0\.01ms !important;/);
    expect(reduced).toMatch(/transition-duration: 0\.01ms !important;/);
  });

  it("each animation only touches transform and opacity", () => {
    const keyframes = [...css.matchAll(/@keyframes (motion-[a-z-]+) \{([\s\S]*?)\n\}/g)];
    expect(keyframes.length).toBeGreaterThanOrEqual(8);
    for (const [, name, body] of keyframes) {
      const properties = [...body.matchAll(/^\s*([a-z-]+):/gm)].map((match) => match[1]);
      for (const property of properties) {
        expect(
          ["opacity", "transform", "stroke-dashoffset"],
          `${name} animates ${property}`,
        ).toContain(property);
      }
    }
  });
});

describe("motion catalog: timings", () => {
  it("the button sinks in 120ms and comes back in 180ms", () => {
    expect(css).toMatch(/transform var\(--duration-base\) var\(--ease-standard\)/);
    expect(block(".button-outline-light:active")).toContain("transition-duration: var(--duration-fast)");
  });

  it("the 'Published!' celebration ends within 700ms", () => {
    expect(block(".published-panel.is-celebrating .spot-art__seal")).toContain("motion-stamp 420ms");
    expect(block(".published-panel.is-celebrating .spot-art__engraving")).toContain(
      "var(--duration-celebrate) var(--ease-standard) 100ms",
    );
    // The last diamond: 420ms of delay + 280ms.
    expect(block(".published-panel.is-celebrating .spot-art__spark path:nth-child(3)")).toContain(
      "animation-delay: 420ms",
    );
    expect(css).toMatch(
      /\.published-panel\.is-celebrating \.spot-art__spark path \{\s*animation: motion-pop 280ms/,
    );
  });
});

// Fixes from the PR #497 review and the polish: what can be proven in the rule.
describe("motion catalog: fixes and polish", () => {
  /** Ranges [start, end) of each block opened by `opener`. */
  function rangesOf(opener: RegExp): Array<[number, number]> {
    return [...css.matchAll(opener)].map((match) => {
      let depth = 0;
      let end = match.index! + match[0].length - 1;
      for (; end < css.length; end += 1) {
        if (css[end] === "{") depth += 1;
        if (css[end] === "}") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      return [match.index!, end] as [number, number];
    });
  }
  const motionRanges = noPreferenceRanges();
  const keyframeRanges = rangesOf(/@keyframes [a-z-]+ \{/g);
  const within = (ranges: Array<[number, number]>, index: number) =>
    ranges.some(([start, end]) => index > start && index < end);

  it("C1: on the phone the strip rises above the navigation bar, in the cookie banner block", () => {
    const rule = css.indexOf("body:has(.platform-mobile-nav) .created-strip {");
    expect(rule).toBeGreaterThan(-1);
    const media = css.lastIndexOf("@media (max-width: 767.98px) {", rule);
    expect(css.slice(media, rule)).toContain("body:has(.platform-mobile-nav) .cookie-consent {");
    expect(block("body:has(.platform-mobile-nav) .created-strip")).toContain(
      "bottom: calc(60px + 0.75rem + env(safe-area-inset-bottom, 0px));",
    );
  });

  it("nothing from the wave starts invisible: outside the animation, opacity 0 only on the decorative glows", () => {
    const waveStart = css.indexOf("Wave D: warmth");
    expect(waveStart).toBeGreaterThan(-1);
    const hits = [...css.slice(waveStart).matchAll(/opacity: 0;/g)].map((match) => waveStart + match.index!);
    expect(hits.length).toBeGreaterThan(0);
    for (const at of hits) {
      if (within(motionRanges, at) || within(keyframeRanges, at)) continue;
      const open = css.lastIndexOf("{", at);
      const selector = css
        .slice(css.lastIndexOf("}", open) + 1, open)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .trim();
      expect(selector, `opacity 0 in the base style of ${selector}`).toMatch(/::(after|before)$/);
    }
  });

  it("the list stagger: 40ms per item, capped at the 6th, whole entrance within 400ms, transform only", () => {
    const rule = block(".motion-stagger > *");
    const [, duration] = rule.match(/animation: motion-lift (\d+)ms/)!;
    const [, cap, step] = rule.match(/animation-delay: calc\(min\(var\(--i, 0\), (\d+)\) \* (\d+)ms\)/)!;
    expect(Number(cap) + 1).toBe(6);
    expect(Number(cap) * Number(step) + Number(duration)).toBeLessThanOrEqual(400);
    // No opacity: the card is painted from the 1st frame and counts toward the LCP.
    expect(css).toMatch(/@keyframes motion-lift \{\s*from \{\s*transform: translateY\(6px\);\s*\}\s*\}/);
  });

  it("Mark complete (the classroom button-solid) sinks when pressed", () => {
    const list = css.indexOf(".button-solid:active,");
    expect(list).toBeGreaterThan(-1);
    expect(css.slice(list, css.indexOf("{", list))).toContain(".button-outline-light:active");
    expect(block(".button-outline-light:active")).toContain("transform: translateY(1px) scale(0.985);");
  });

  it("menu, notices, stagger and card hover live in no-preference", () => {
    for (const selector of [".motion-drop-in", ".motion-rise-in", ".motion-stagger > *", ".motion-hover-lift:hover"]) {
      const at = css.indexOf(`${selector} {`);
      expect(at, selector).toBeGreaterThan(-1);
      expect(within(motionRanges, at), selector).toBe(true);
    }
    expect(block(".motion-drop-in")).toContain("animation: dropdown-in var(--duration-fast)");
  });
});
