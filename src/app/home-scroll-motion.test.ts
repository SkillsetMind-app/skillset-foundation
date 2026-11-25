import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// The home scroll choreography only exists in the CSS (animation-timeline):
// jsdom does not scroll or animate, so what is proven here are the three safety
// nets of the rule. Same design as onda-d-motion.test.ts.
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

/** Slice [start, end) of the block that begins at `opener`, counting braces. */
function blockRange(opener: string, from = 0): [number, number] {
  const start = css.indexOf(opener, from);
  expect(start, `${opener} not found`).toBeGreaterThan(-1);
  let depth = 0;
  let end = start + opener.length - 1;
  for (; end < css.length; end += 1) {
    if (css[end] === "{") depth += 1;
    if (css[end] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return [start, end];
}

const sectionStart = css.indexOf("Home: scroll choreography");
const [mediaStart, mediaEnd] = blockRange("@media (prefers-reduced-motion: no-preference) {", sectionStart);
const [supportsStart, supportsEnd] = blockRange(
  "@supports (animation-timeline: view()) and (animation-range: entry 0% cover 30%) and (view-timeline: --x block) {",
  mediaStart,
);

describe("home: coreografia de rolagem", () => {
  it("every scroll timeline lives inside no-preference AND the @supports", () => {
    expect(sectionStart).toBeGreaterThan(-1);
    expect(supportsStart).toBeGreaterThan(mediaStart);
    expect(supportsEnd).toBeLessThan(mediaEnd);

    const uses = [...css.matchAll(/(?:animation|view)-timeline:/g)];
    expect(uses.length).toBeGreaterThan(10);
    for (const use of uses) {
      const inside = use.index! > supportsStart && use.index! < supportsEnd;
      expect(inside, `fora do @supports: ${css.slice(use.index!, use.index! + 60)}`).toBe(true);
    }
  });

  it("only the home enters the choreography: every rule is scoped to .home-scroll", () => {
    // Without the comments: a rule right below a comment was read
    // as "/* ... */ selector" and escaped the check.
    const body = css.slice(supportsStart, supportsEnd).replace(/\/\*[\s\S]*?\*\//g, "");
    const selectors = [...body.matchAll(/(?:^|\n)\s*([^@{}\n][^{}]*?)\s*\{/g)]
      .map((match) => match[1].trim())
      // Only rule selectors are left: nested @media and @supports and
      // comments do not count.
      .filter((selector) => !selector.startsWith("@"));
    expect(selectors.length).toBeGreaterThan(35);
    for (const selector of selectors) {
      for (const part of selector.split(",")) {
        expect(part, `rule outside the home: ${part.trim()}`).toMatch(/\.home-scroll/);
      }
    }
  });

  it("without support or with reduced motion the reading bar does not show", () => {
    const base = css.indexOf(".home-scroll-progress {", sectionStart);
    expect(base).toBeGreaterThan(-1);
    expect(base).toBeLessThan(mediaStart);
    expect(css.slice(base, css.indexOf("}", base))).toContain("display: none;");
  });

  it("nothing disappears for good: the old entrance is only turned off inside the @supports", () => {
    const off = css.indexOf("html.js .home-scroll .reveal-on-view:not(.reveal-on-view--in) {");
    expect(off).toBeGreaterThan(supportsStart);
    expect(off).toBeLessThan(supportsEnd);
  });

  // The starting states (opacity 0, offset) only exist in the keyframes
  // motion-scroll-*. Anyone who uses them outside the @supports hides content in a
  // browser without animated scrolling.
  it("no rule uses the choreography frames outside the @supports", () => {
    const uses = [...css.matchAll(/animation(?:-name)?:\s*motion-scroll-/g)];
    expect(uses.length).toBeGreaterThan(10);
    for (const use of uses) {
      const inside = use.index! > supportsStart && use.index! < supportsEnd;
      expect(inside, `fora do @supports: ${css.slice(use.index!, use.index! + 60)}`).toBe(true);
    }
  });

  it("with keyboard focus inside, the top text does not disappear", () => {
    const rule = css.indexOf(".home-scroll .home-hero__copy:has(:focus-visible) {");
    expect(rule).toBeGreaterThan(supportsStart);
    expect(rule).toBeLessThan(supportsEnd);
    expect(css.slice(rule, css.indexOf("}", rule))).toContain("animation: none;");
  });
});

// The three computer scenes: the pinned step by step, the promise curtain and
// the depth of the cards. Besides the three nets above, a size @media:
// outside it (phone, short screen) the page has the layout and height as before.
const scenesOpener =
  "@media (min-width: 1280px) and (min-height: 640px), (min-width: 1024px) and (min-height: 720px) {";
const [scenesStart, scenesEnd] = blockRange(scenesOpener, supportsStart);

function insideScenes(index: number): boolean {
  return index > scenesStart && index < scenesEnd;
}

/** Body of the rule `selector {` that lives in the scenes block. */
function sceneRule(selector: string): string {
  const at = css.indexOf(`${selector} {`, scenesStart);
  expect(at, `${selector} not found in the scenes`).toBeGreaterThan(-1);
  expect(insideScenes(at), `${selector} outside the scenes`).toBe(true);
  return css.slice(at, css.indexOf("}", at));
}

function keyframesBody(name: string): string {
  const at = css.indexOf(`@keyframes ${name} {`);
  expect(at, `@keyframes ${name} not found`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf("\n}", at));
}

/** cubic-bezier(0.2, 0.6, 0.2, 1), a --ease-standard. */
function easeStandard(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bezier = (t: number, p1: number, p2: number) =>
    3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t * t * p2 + t ** 3;
  let [lo, hi] = [0, 1];
  for (let i = 0; i < 50; i += 1) {
    const mid = (lo + hi) / 2;
    if (bezier(mid, 0.2, 0.2) < x) lo = mid;
    else hi = mid;
  }
  return bezier((lo + hi) / 2, 0.6, 1);
}

/** The curtain read from the CSS: ellipse geometry, scale per stretch and ruler. */
function curtainModel() {
  const rule = sceneRule(".home-scroll .home-promise::before");
  const percent = (property: string) =>
    Number(rule.match(new RegExp(`\\s${property}: (-?[\\d.]+)%;`))![1]) / 100;
  const [width, height] = [percent("width"), percent("height")];
  const stops = [
    ...keyframesBody("motion-scroll-curtain").matchAll(
      /(\d+)% \{\s*transform: (?:scale\(([\d.]+)\)|none);/g,
    ),
  ].map(([, at, scale]) => [Number(at) / 100, scale ? Number(scale) : 1] as const);
  const stretch = Number(rule.match(/animation-range: cover 0% cover (\d+)svh;/)![1]) / 100;
  const scaleAt = (u: number) => {
    if (u <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i += 1) {
      const [u0, s0] = stops[i - 1];
      const [u1, s1] = stops[i];
      if (u <= u1) return s0 + ((s1 - s0) * (u - u0)) / (u1 - u0);
    }
    return stops[stops.length - 1][1];
  };
  return {
    kh: width / 2,
    kv: height / 2,
    top: percent("top"),
    left: percent("left"),
    stretch,
    scaleAt,
    /** y (px below the top of the strip) of the arc's edge at dx, with the top of the strip raised `o` screens. */
    edgeAt(dx: number, o: number, bandWidth: number, bandHeight: number) {
      const s = scaleAt(o / stretch);
      const a = (width / 2) * bandWidth * s;
      if (Math.abs(dx) >= a) return bandHeight;
      return bandHeight - (height / 2) * bandHeight * s * Math.sqrt(1 - (dx / a) ** 2);
    },
  };
}

describe("home: cenas do computador", () => {
  it("the size block lives inside the @supports, after the 1024 block", () => {
    expect(scenesStart).toBeGreaterThan(css.indexOf("@media (min-width: 1024px) {", supportsStart));
    expect(scenesEnd).toBeLessThan(supportsEnd);
    // The pinned panel only exists from 1024 of width and 640 of height.
    for (const query of scenesOpener.slice("@media ".length, -2).split(", ")) {
      const [, width] = query.match(/min-width: (\d+)px/)!;
      const [, height] = query.match(/min-height: (\d+)px/)!;
      expect(Number(width)).toBeGreaterThanOrEqual(1024);
      expect(Number(height)).toBeGreaterThanOrEqual(640);
    }
  });

  it("tall strip, pinned screen and curtain only exist inside the size block", () => {
    const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const needle of [
      ".home-how {",
      ".home-how__panel {",
      ".home-promise {",
      ".home-promise::before {",
      "220svh",
      "view-timeline: --home-how",
      "view-timeline: --home-curtain",
    ]) {
      const hits = [...css.matchAll(new RegExp(escape(needle), "g"))];
      expect(hits.length, needle).toBeGreaterThan(0);
      for (const hit of hits) {
        expect(insideScenes(hit.index!), `outside the scenes: ${needle}`).toBe(true);
      }
    }
    // No other place on the home sticks below the bar.
    const pinned = [...css.matchAll(/position: sticky;\s+top: var\(--site-header-height\);/g)];
    expect(pinned).toHaveLength(1);
    expect(insideScenes(pinned[0].index!)).toBe(true);
  });

  it("scene 1: the strip is 100% of the screen + 3 x 40% and the panel sticks below the bar", () => {
    const track = sceneRule(".home-scroll .home-how");
    expect(track).toContain("height: calc(220svh - var(--site-header-height));");
    // The anchor lands the instant the screen locks: title and step 1 in view.
    expect(track).toContain("scroll-margin-top: var(--site-header-height);");
    expect(track).toContain("view-timeline-inset: var(--site-header-height) 0px;");

    const panel = sceneRule(".home-scroll .home-how__panel");
    expect(panel).toContain("position: sticky;");
    expect(panel).toContain("top: var(--site-header-height);");
    expect(panel).toContain("min-height: calc(100svh - var(--site-header-height));");

    // Extra scroll of the pin = strip - panel (the bar is discounted from both):
    // at most 2.2 screens.
    const trackScreens = Number(track.match(/height: calc\((\d+)svh/)![1]);
    const panelScreens = Number(panel.match(/min-height: calc\((\d+)svh/)![1]);
    expect(trackScreens - panelScreens).toBeLessThanOrEqual(220);
    expect(trackScreens - panelScreens).toBeGreaterThanOrEqual(100);
  });

  it("scene 1: each step has one owner per property and lights up in order", () => {
    const names = ["first", "second", "third"];
    names.forEach((name, index) => {
      const step = sceneRule(`.home-scroll .home-step:nth-child(${index + 1})`);
      expect(step).toContain(`animation: motion-scroll-step-${name} `);
      expect(step).toContain("animation-timeline: --home-how;");
      expect(keyframesBody(`motion-scroll-step-${name}`)).not.toContain("transform");
      expect(keyframesBody(`motion-scroll-mark-${name}`)).not.toContain("opacity");
    });

    // Calm never below 0.5; at the end (100%) all three are whole.
    for (const name of names) {
      const body = keyframesBody(`motion-scroll-step-${name}`);
      for (const [, value] of body.matchAll(/opacity: ([\d.]+);/g)) {
        expect(Number(value)).toBeGreaterThanOrEqual(0.5);
      }
      const last = body.slice(body.lastIndexOf("100%"));
      expect(last).toMatch(/opacity: 1;/);
    }
  });

  it("scene 2: the curtain is decorative, token-colored and clipped by the strip", () => {
    const band = sceneRule(".home-scroll .home-promise");
    expect(band).toContain("overflow: clip;");
    expect(band).toContain("--home-curtain: var(--color-primary);");
    const dark = sceneRule('[data-theme="dark"] .home-scroll .home-promise');
    expect(dark).toContain("--home-curtain: var(--color-surface-soft);");

    const curtain = sceneRule(".home-scroll .home-promise::before");
    expect(curtain).toContain('content: "";');
    expect(curtain).toContain("pointer-events: none;");
    expect(curtain).toContain("background: var(--home-curtain);");
  });

  it("scene 2: the arc is born at the middle of the bottom edge, covers the corners at 1 and does not cut straight before 85%", () => {
    const arc = curtainModel();
    // Ellipse center at the middle of the strip's bottom edge.
    expect(arc.left + arc.kh).toBeCloseTo(0.5, 5);
    expect(arc.top + arc.kv).toBeCloseTo(1, 5);
    // At scale 1 the arc goes past the top corners (at 50% of the width).
    expect(arc.kv * Math.sqrt(1 - (0.5 / arc.kh) ** 2)).toBeGreaterThan(1);
    // Stretch: from the top of the strip at the bottom of the screen to the top at 45% of the screen.
    expect(arc.stretch).toBe(0.55);
    expect(arc.scaleAt(0)).toBeLessThanOrEqual(0.15);
    expect(arc.scaleAt(1)).toBe(1);
    for (let u = 0; u < 0.84; u += 0.01) {
      expect(arc.kv * arc.scaleAt(u), `top cut straight at ${u.toFixed(2)}`).toBeLessThan(1);
    }
  });

  it("scene 2: each text block only appears covered, in order, and is whole before 75% of the screen", () => {
    const arc = curtainModel();
    const range = (selector: string) => {
      const [, from, to] = sceneRule(selector).match(/animation-range: cover (\d+)svh cover (\d+)svh;/)!;
      return [Number(from) / 100, Number(to) / 100] as const;
    };
    // Offsets measured from the top of the strip (estimated on the layout of 1024
    // and 1280+): overline, title, paragraph and button; the letter at 96px,
    // with its first text at 124px.
    const blocks = [
      { selector: ".home-scroll .home-promise__text > *", offset: 0 },
      { selector: ".home-scroll .home-promise__text > h2", offset: 28 },
      { selector: ".home-scroll .home-promise__text > h2 + p", offset: 164 },
      { selector: ".home-scroll .home-promise__text > a", offset: 244 },
    ].map((block) => ({ ...block, range: range(block.selector) }));
    const charter = range(".home-scroll .home-promise__charter");

    const starts = [...blocks.map((block) => block.range[0]), charter[0]];
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    expect(new Set(starts).size).toBe(starts.length);

    for (const { width, half, eyebrow } of [
      { width: 1024, half: 480, eyebrow: 171 },
      { width: 1440, half: 608, eyebrow: 185 },
    ]) {
      for (const bandHeight of [620, 660, 720]) {
        for (const vh of [720, 900, 1080, 1200]) {
          const where = `${width}x${vh}, faixa ${bandHeight}px`;
          for (const block of blocks) {
            const y = eyebrow + block.offset;
            const [from, to] = block.range;
            // Light text only with the curtain behind it (left corner of the column).
            expect(arc.edgeAt(-half, from, width, bandHeight), `${block.selector} without a curtain, ${where}`)
              .toBeLessThanOrEqual(y);
            // Whole when its top reaches 75% of the screen.
            const deadline = 0.25 + y / vh;
            expect(easeStandard((deadline - from) / (to - from)), `${block.selector} apagado, ${where}`)
              .toBeGreaterThanOrEqual(0.95);
          }
          // The letter only enters with its top edge (right corner) covered.
          expect(arc.edgeAt(half, charter[0], width, bandHeight), `carta boiando, ${where}`).toBeLessThanOrEqual(96);
          const deadline = 0.25 + 124 / vh;
          expect(easeStandard((deadline - charter[0]) / (charter[1] - charter[0])), `carta apagada, ${where}`)
            .toBeGreaterThanOrEqual(0.95);
          // The first clause (285px) starts after the letter.
          const [clauseFrom] = range(".home-scroll .home-promise__clause:nth-child(n)");
          expect(clauseFrom + 285 / vh).toBeGreaterThan(charter[0]);
        }
      }
    }

    expect(
      sceneRule(".home-scroll .home-promise:has(:focus-visible) .home-promise__text > *"),
    ).toContain("animation: none;");
    // The button drops the transform at the end of the entrance: its :hover works again.
    expect(sceneRule(".home-scroll .home-promise__text > a")).toContain(
      "animation: motion-scroll-rise 1ms var(--ease-standard) backwards;",
    );
  });

  it("scene 3: the course photo animates without pinning the hover's transform", () => {
    const photo = sceneRule(".home-scroll .marketplace-course-grid > li .marketplace-card__media > img");
    expect(photo).toContain("animation: motion-scroll-settle 1ms var(--ease-standard) backwards;");
    expect(photo).not.toMatch(/\b(?:both|forwards)\b/);
    // The approved hover (500ms) is still the first `.marketplace-card__media img {`.
    expect(css.indexOf(".marketplace-card__media img {")).toBeGreaterThan(supportsEnd);
  });

  it("the new frames only touch transform and opacity", () => {
    for (const name of [
      "motion-scroll-step-first",
      "motion-scroll-step-second",
      "motion-scroll-step-third",
      "motion-scroll-mark-first",
      "motion-scroll-mark-second",
      "motion-scroll-mark-third",
      "motion-scroll-curtain",
      "motion-scroll-assemble",
      "motion-scroll-settle",
      "motion-scroll-fact",
    ]) {
      const properties = [...keyframesBody(name).matchAll(/^\s*([a-z-]+):/gm)].map((match) => match[1]);
      expect(properties.length, name).toBeGreaterThan(0);
      for (const property of properties) {
        expect(["opacity", "transform"], `${name} anima ${property}`).toContain(property);
      }
    }
  });

  it("the top does not enter the scenes", () => {
    const body = css.slice(scenesStart, scenesEnd);
    expect(body).not.toMatch(/home-hero|hero-portrait|hero-copy/);
  });

  it("the scene hooks are still in the JSX", () => {
    const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
    expect(read("src/app/page.tsx")).toMatch(/id="how-it-works" className="home-how /);
    expect(read("src/components/site/how-it-works-strip.tsx")).toContain('className="home-how__panel ');
    expect(read("src/components/site/promise-preview-band.tsx")).toContain('className="home-promise ');
  });

  // M6: the facts strip enters at both sizes (outside the scenes block),
  // one number after the other, with only opacity and 12px. Outside the locks there
  // is no rule at all for it: still and whole.
  it("facts strip: light staircase behind the locks, whole before 75% of the screen", () => {
    const hits = [...css.matchAll(/\.home-facts/g)];
    expect(hits.length).toBe(4);
    for (const hit of hits) {
      expect(hit.index! > supportsStart && hit.index! < supportsEnd, "fact outside the @supports").toBe(true);
      expect(insideScenes(hit.index!), "fact pinned to the scenes block").toBe(false);
    }

    const rule = (selector: string) => {
      const at = css.indexOf(`${selector} {`, supportsStart);
      expect(at, selector).toBeGreaterThan(-1);
      return css.slice(at, css.indexOf("}", at));
    };
    const base = rule(".home-scroll .home-facts__item");
    expect(base).toContain("animation: motion-scroll-fact 1ms var(--ease-standard) both;");
    expect(base).toContain("animation-timeline: view();");

    // Stretches in svh from the top of the fact entering through the bottom edge:
    // starts in order and each end before the top reaches 75% of the screen.
    const ranges = [1, 2, 3, 4].map((n) => {
      const body = n === 1 ? base : rule(`.home-scroll .home-facts__item:nth-child(${n})`);
      const [, from, to] = body.match(/animation-range: cover (\d+)(?:%|svh) cover (\d+)svh;/)!;
      return [Number(from), Number(to)] as const;
    });
    for (let i = 1; i < ranges.length; i += 1) {
      expect(ranges[i][0]).toBeGreaterThan(ranges[i - 1][0]);
    }
    for (const [from, to] of ranges) {
      expect(to).toBeGreaterThan(from);
      expect(to).toBeLessThanOrEqual(25);
    }

    const frames = keyframesBody("motion-scroll-fact");
    expect(frames).toContain("opacity: 0;");
    expect(frames).toContain("transform: translateY(12px);");
  });

  it("no ancestor of the home clips scrolling (the sticky needs it)", () => {
    const shell = css.slice(css.indexOf(".page-shell {"), css.indexOf("}", css.indexOf(".page-shell {")));
    expect(shell).toContain("overflow-x: clip;");
    expect(shell).not.toMatch(/overflow(?:-[xy])?: (?:hidden|auto|scroll)/);
  });

  // Home photos: the "who it's for" strip and the photo of the final strip only move
  // on the computer, in a 1024px block after all the other rules. On the
  // phone and the tablet none of them moves.
  it("home photos: motion only on the computer, and the final photo settles before the title", () => {
    const [start, end] = blockRange("@media (min-width: 1024px) {", css.indexOf("12. Home photos"));
    expect(start).toBeGreaterThan(scenesEnd);
    expect(end).toBeLessThan(supportsEnd);
    for (const needle of [/\.home-who/g, /\.home-creators__photo/g]) {
      const hits = [...css.matchAll(needle)];
      expect(hits.length, String(needle)).toBeGreaterThan(0);
      for (const hit of hits) {
        expect(hit.index! > start && hit.index! < end, `${needle} outside the computer block`).toBe(true);
      }
    }

    const rule = (selector: string) => {
      const at = css.indexOf(`${selector} {`, start);
      expect(at, selector).toBeGreaterThan(-1);
      expect(at, selector).toBeLessThan(end);
      return css.slice(at, css.indexOf("}", at));
    };
    const range = (body: string) =>
      body.match(/animation-range: cover (\d+)(?:%|svh) cover (\d+)svh;/)!.slice(1).map(Number);

    // The full-width strip does not grow; the photo recedes until it settles, and the
    // title only starts with the photo 3/4 of the way done.
    expect(rule(".home-scroll .home-creators")).toContain("animation: none;");
    const photo = rule(".home-scroll .home-creators__photo img");
    expect(photo).toContain("animation: motion-scroll-settle 1ms var(--ease-standard) both;");
    expect(photo).toContain("animation-timeline: --home-creators;");
    const [, photoEnd] = range(photo);
    const [leadFrom, leadTo] = range(rule(".home-scroll .home-creators__lead"));
    expect(leadFrom / photoEnd).toBeGreaterThanOrEqual(0.75);
    expect(leadTo).toBeGreaterThan(photoEnd);

    // The three portraits: in a staircase, only opacity and 12px, whole before the
    // top goes past 75% of the screen.
    expect(rule(".home-scroll .home-who__photo")).toContain("animation: motion-scroll-fact 1ms var(--ease-standard) both;");
    const portraits = [
      rule(".home-scroll .home-who__photo"),
      rule(".home-scroll .home-who__photo:nth-child(2)"),
      rule(".home-scroll .home-who__photo:nth-child(3)"),
    ].map(range);
    for (let i = 1; i < portraits.length; i += 1) expect(portraits[i][0]).toBeGreaterThan(portraits[i - 1][0]);
    for (const [from, to] of portraits) {
      expect(to).toBeGreaterThan(from);
      expect(to).toBeLessThanOrEqual(25);
    }
  });
});
