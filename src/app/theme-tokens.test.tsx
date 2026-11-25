import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Dark-mode contrast regressions are invisible to render tests (jsdom does not
// composite colors), so guard the two invariants the fix actually rests on:
// every semantic token has a dark value, and the platform surfaces that used to
// bake in literal white now read the surface token instead.
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} block not found`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("\n}", start));
}

describe("platform theme tokens", () => {
  it("redefines every semantic token that dark mode used to inherit from light", () => {
    const dark = block('[data-theme="dark"]');
    for (const token of [
      "--color-ink-indigo",
      "--color-on-primary",
      "--color-warning-fg",
      "--color-line",
      "--color-line-strong",
      "--focus-ring",
    ]) {
      expect(dark, `${token} missing from dark theme`).toContain(`${token}:`);
    }
  });

  it("keeps dark borders above the 3:1 non-text floor", () => {
    // 0.34 / 0.44 are the minimum alphas clearing 3:1 on all four dark surfaces.
    const dark = block('[data-theme="dark"]');
    expect(dark).toContain("--color-line: rgba(255, 255, 255, 0.34)");
    expect(dark).toContain("--color-line-strong: rgba(255, 255, 255, 0.44)");
  });

  // The focus ring changed color per screen: the global rule used --color-primary
  // and 13 elements painted the old navy (rgba(44,82,130,.24/.28/.35)) inline.
  it("has one focus ring token and no screen paints its own ring colour", () => {
    expect(block(":root")).toContain("--focus-ring:");
    expect(css).toMatch(/:focus-visible[^{]*\{\s*outline: 2px solid var\(--focus-ring\)/);

    const files = readdirSync(join(process.cwd(), "src"), { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".tsx") && !e.name.endsWith(".test.tsx"))
      .map((e) => join(e.parentPath, e.name));
    expect(files.length).toBeGreaterThan(0);
    const inlineRing = files.filter((file) =>
      /focus-visible:(?:outline|ring)-\[rgba\(44,\s*82,\s*130/.test(readFileSync(file, "utf8")),
    );
    expect(inlineRing).toEqual([]);
  });

  it("leaves no literal white on platform surfaces that must invert", () => {
    for (const selector of [
      ".platform-hero-card",
      ".studio-welcome-card",
      ".studio-action-card",
      ".credential-hero",
      ".btn-signin",
      ".studio-activity-card",
      ".cookie-consent",
      ".course-builder-stepper",
      ".course-builder-rail",
      ".course-builder-panel",
      ".marketplace-card__wishlist",
    ]) {
      expect(block(selector), `${selector} still bakes in white`).not.toMatch(
        /#ffffff|rgba\(255, 255, 255, 0\.9/,
      );
    }
  });

  it("keeps course editing sections unframed instead of nesting decorative cards", () => {
    for (const selector of [".course-builder-hero", ".course-builder-stepper", ".course-builder-panel"]) {
      expect(block(selector)).not.toMatch(/border:|border-radius:|box-shadow:|gradient\(/);
    }
    expect(css).not.toContain('[data-theme="dark"] .course-builder-hero');
  });
});

// The selector list above only guards surfaces someone remembered to add to it,
// which is how .member-lesson-card__status and .member-module-card__seal stayed
// broken. This computes the invariant instead: for every rule that sets BOTH a
// color and a background, dark must not be worse than light. A pairing that
// fails in both themes is a palette decision (white on brass --color-accent),
// not a dark regression, so it is deliberately not caught here.
type Rgba = [number, number, number, number];

const sheet = css.replace(/\/\*[\s\S]*?\*\//g, "");

function palette(selector: string): Record<string, string> {
  const start = sheet.indexOf(`${selector} {`);
  const body = sheet.slice(start, sheet.indexOf("\n}", start));
  return Object.fromEntries(
    [...body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map(([, k, v]) => [k, v.trim()]),
  );
}

const light = palette(":root");
const dark = { ...light, ...palette('[data-theme="dark"]') };

function parseColor(raw: string, vars: Record<string, string>, depth = 0): Rgba | null {
  if (depth > 6) return null;
  const value = raw.replace("!important", "").trim();

  const ref = /^var\((--[a-z0-9-]+)(?:\s*,\s*(.+))?\)$/.exec(value);
  if (ref) {
    const resolved = vars[ref[1]];
    if (resolved !== undefined) return parseColor(resolved, vars, depth + 1);
    return ref[2] ? parseColor(ref[2], vars, depth + 1) : null;
  }

  const long = /^#([0-9a-f]{6})$/i.exec(value);
  if (long) {
    const h = long[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  }

  const short = /^#([0-9a-f]{3})$/i.exec(value);
  if (short) {
    const [r, g, b] = [...short[1]].map((c) => parseInt(c + c, 16));
    return [r, g, b, 1];
  }

  const fn = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/.exec(value);
  if (fn) {
    return [Number(fn[1]), Number(fn[2]), Number(fn[3]), fn[4] ? Number(fn[4]) : 1];
  }

  return null;
}

function over(color: Rgba, backdrop: readonly number[]): [number, number, number] {
  const a = color[3];
  return [0, 1, 2].map((i) => color[i] * a + backdrop[i] * (1 - a)) as [number, number, number];
}

function luminance([r, g, b]: readonly number[]): number {
  const [lr, lg, lb] = [r, g, b].map((raw) => {
    const c = raw / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

// `baseToken` is the surface a translucent background composites over. Member
// area rules sit on --ma-bg (the course's own page), NOT --color-base (the
// platform page) — compositing them over the platform base invents failures.
function ratio(
  fg: string,
  bg: string,
  vars: Record<string, string>,
  baseToken = "--color-base",
): number | null {
  const base = parseColor(vars[baseToken], vars);
  const fgColor = parseColor(fg, vars);
  const bgColor = parseColor(bg, vars);
  if (!base || !fgColor || !bgColor) return null;

  const backdrop = bgColor[3] < 1 ? over(bgColor, base) : bgColor.slice(0, 3);
  const text = fgColor[3] < 1 ? over(fgColor, backdrop) : fgColor.slice(0, 3);
  const [hi, lo] = [luminance(text), luminance(backdrop)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

describe("neutral dark actions", () => {
  const primaryTokens = ["--color-primary", "--color-primary-dark", "--color-primary-light"];
  const surfaces = ["--color-base", "--color-surface", "--color-surface-soft", "--color-surface-strong"];

  it("uses neutral primary ink while retaining the dark canvas, gold and informational blue", () => {
    for (const token of primaryTokens) {
      const color = parseColor(`var(${token})`, dark);
      expect(color, token).not.toBeNull();
      const channels = color!.slice(0, 3);
      expect(Math.max(...channels) - Math.min(...channels), token).toBeLessThanOrEqual(12);
      for (const surface of surfaces) {
        expect(ratio(`var(${token})`, `var(${surface})`, dark), `${token} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(surfaces.map((token) => dark[token])).toEqual(["#0a0f1a", "#0f1626", "#141d33", "#1c2841"]);
    expect(dark["--color-info"]).toBe("#8fb4e4");
    expect(dark["--color-accent"]).toBe(light["--color-accent"]);
    expect(light["--color-primary"]).toBe("#102a43");
  });

  it("keeps primary labels and keyboard focus readable in both themes", () => {
    for (const vars of [light, dark]) {
      for (const token of primaryTokens) {
        expect(ratio("var(--color-on-primary)", `var(${token})`, vars), token).toBeGreaterThanOrEqual(4.5);
      }
      for (const surface of surfaces) {
        expect(ratio("var(--focus-ring)", `var(${surface})`, vars), surface).toBeGreaterThanOrEqual(3);
      }
    }
  });

  // The segmented selector (PeriodTabs) decides the cycle the teacher pays. In
  // dark the chosen pill and the frame almost blend together, so it
  // gets an outline in --color-primary: it must pass 3:1 (the limit for a
  // non-text element) against the frame and against the pill itself.
  it("keeps the selected segmented option distinct from its track in dark theme", () => {
    const ring = block('[data-theme="dark"] .studio-range-tabs button[aria-pressed="true"]');
    expect(ring).toMatch(/inset 0 0 0 1\.5px var\(--color-primary\)/);
    // The dark rule comes after the base (which stays the same in light).
    expect(css.indexOf('[data-theme="dark"] .studio-range-tabs button[aria-pressed="true"] {')).toBeGreaterThan(
      css.indexOf('.studio-range-tabs button[aria-pressed="true"] {'),
    );
    expect(block('.studio-range-tabs button[aria-pressed="true"]')).toContain("box-shadow: var(--shadow-soft);");
    const chip = /background:\s*([^;]+);/.exec(block('.studio-range-tabs button[aria-pressed="true"]'))?.[1];
    const track = /background:\s*([^;]+);/.exec(block(".studio-range-tabs"))?.[1];
    for (const backdrop of [chip!, track!]) {
      expect(ratio("var(--color-primary)", backdrop, dark), backdrop).toBeGreaterThanOrEqual(3);
    }
  });

  // These utility-only fills are outside the stylesheet's color/background
  // guard below. Read the real classes, not a mocked component's styling.
  it.each([
    // teacher-members-area-hub.tsx left the list: its only filled control
    // was the spaces/communities selector, which became the house segmented selector
    // (PeriodTabs, no navy fill; its contrast is checked by the stylesheet).
    // teacher-studio-dashboard.tsx left the list: its only filled control
    // was the milestones ("Creator milestones"), which repeated the steps and left.
    // course-manage-hub.tsx left too: its only fill was the
    // blue dot of the "✓" in the publish list, which became the builder check.
    // course-landing-editor.tsx left: the "Save page" became the house Button
    // (.button-solid) and the chosen template became the light pill of the
    // segmented selector; no hand-made navy fill is left in it.
    "learn/learning-paths-rows.tsx",
    // account/notifications-inbox.tsx left the list: the "Mark all read" became the
    // platform Button (.button-solid, with its own dark theme rule).
    "courses/course-landing-blocks.tsx",
  ])("uses the primary foreground on filled controls in %s", (file) => {
    const source = readFileSync(join(process.cwd(), "src/components", file), "utf8");
    const fills = [...source.matchAll(/"([^"\n]*\bbg-\[var\(--color-primary\)\][^"\n]*)"/g)]
      .map((match) => match[1])
      .filter((classes) => classes.includes("text-"));
    expect(fills.length, `${file}: no filled text control inspected`).toBeGreaterThan(0);
    for (const classes of fills) {
      expect(classes, file).toContain("text-[var(--color-on-primary)]");
      expect(classes, file).not.toMatch(/\btext-white\b/);
    }
  });

  it("keeps promotional panels dark instead of turning them into large white surfaces", () => {
    const surface = block('[data-theme="dark"] .primary-fill-card');
    expect(surface).toContain("background: var(--color-surface-strong)");
    const foreground = block('[data-theme="dark"] .primary-fill-card *').match(/\scolor:\s*([^;]+);/)?.[1];
    expect(foreground).toBeTruthy();
    expect(ratio(foreground!, "var(--color-surface-strong)", dark)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps informational chips blue rather than inheriting neutral action ink", () => {
    const foreground = block(".status-chip--info").match(/\scolor:\s*([^;]+);/)?.[1];
    expect(foreground).toBeTruthy();
    for (const vars of [light, dark]) {
      expect(parseColor(foreground!, vars)).toEqual(parseColor("var(--color-info)", vars));
      expect(ratio(foreground!, "var(--color-surface-strong)", vars)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps translucent storefront preview copy readable without an uploaded banner", () => {
    const source = readFileSync(join(process.cwd(), "src/components/teacher/storefront-settings-panel.tsx"), "utf8");
    const header = /className="([^"\n]*\bmin-h-32\b[^"\n]*)"/.exec(source);
    expect(header).not.toBeNull();
    const preview = source.slice(header!.index, source.indexOf("</section>", header!.index));
    const background = /\bbg-\[([^\]]+)\]/.exec(header![1])?.[1] ?? "";
    const overlay = /bg-\[(rgba\([^\]]+\))\]/.exec(preview)?.[1] ?? "";
    const opacities = [...preview.matchAll(/\btext-white\/(\d+)\b/g)].map((match) => Number(match[1]) / 100);
    expect(opacities.length).toBeGreaterThan(0);
    for (const vars of [light, dark]) {
      const base = parseColor(background, vars);
      const tint = parseColor(overlay, vars);
      expect(base).not.toBeNull();
      expect(tint).not.toBeNull();
      const composite = `rgb(${over(tint!, base!).join(", ")})`;
      for (const opacity of opacities) {
        expect(ratio(`rgba(255, 255, 255, ${opacity})`, composite, vars)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe.each([["light", light], ["dark", dark]] as const)("semantic success contrast — %s", (_theme, vars) => {
  it.each(["--color-base", "--color-surface", "--color-surface-soft", "--color-surface-strong"])(
    "keeps success text at AA on %s and its success tint",
    (surface) => {
      for (const background of [surface, "--color-success-soft"]) {
        const contrast = ratio("var(--color-success-fg)", `var(${background})`, vars, surface);
        expect(contrast, `${background} over ${surface} must resolve`).not.toBeNull();
        expect(contrast!, `${background} over ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    },
  );
});

// The four InlineAlert boxes (ui/inline-alert.tsx): the text of each tone
// over its own background, on any surface where the box lands. The error
// background is translucent, so the computation composes over the surface.
describe.each([["light", light], ["dark", dark]] as const)("InlineAlert tone contrast — %s", (_theme, vars) => {
  it.each([
    ["--color-danger-fg", "--color-danger-soft"],
    ["--color-warning-fg", "--color-warning-soft"],
    ["--color-success-fg", "--color-success-soft"],
    ["--color-ink-soft", "--color-info-soft"],
  ])("keeps %s at AA on %s over every surface", (foreground, background) => {
    for (const surface of ["--color-base", "--color-surface", "--color-surface-soft", "--color-surface-strong"]) {
      const contrast = ratio(`var(${foreground})`, `var(${background})`, vars, surface);
      expect(contrast, `${background} over ${surface} must resolve`).not.toBeNull();
      expect(contrast!, `${background} over ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

/**
 * First top-level token of a background shorthand (`#fff url(...) no-repeat`).
 *
 * Splitting on EVERY space breaks `rgba(39, 160, 106, 0.12)` into `rgba(39,`,
 * which parseColor cannot read, so ratio() returned null and the rule was
 * skipped SILENTLY — not reported as passing, not reported as failing, just
 * gone. 72 rules in this sheet use a spaced rgba background; none of them were
 * ever evaluated. Split only at paren depth 0.
 */
function firstColorToken(value: string): string {
  let depth = 0;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (ch === " " && depth === 0) return value.slice(0, i);
  }
  return value;
}

const rules = [...sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
  ([, selector, body]) => [selector.split(/\s+/).join(" ").trim(), body] as const,
);

// Every base selector a [data-theme="dark"] rule already recolors. Split on
// commas first: dark patches are usually written as one comma-joined rule, so
// a substring search for `[data-theme="dark"] <selector> {` misses most of them.
const darkOverrides = new Set<string>();
for (const [selector, body] of rules) {
  if (!selector.includes('[data-theme="dark"]')) continue;
  if (!/(?:^|;|\s)(?:color|background(?:-color)?)\s*:/.test(body)) continue;
  for (const part of selector.split(",")) {
    darkOverrides.add(part.replaceAll('[data-theme="dark"]', "").trim());
  }
}
// `[data-theme="dark"] .foo *` recolors every descendant of .foo too.
const coveredPrefixes = [...darkOverrides]
  .filter((s) => s.endsWith("*"))
  .map((s) => s.slice(0, -1).trim())
  .filter(Boolean);

describe("dark mode contrast", () => {
  it("keeps gold CTAs above AA in both themes, including hover", () => {
    for (const base of [".btn-cta-hero", ".button-accent", ".button-solid-light"]) {
      const foreground = block(base).match(/\scolor:\s*([^;]+);/)?.[1];
      expect(foreground).toBeTruthy();
      for (const vars of [light, dark]) {
        for (const selector of [base, `${base}:hover`]) {
          const background = block(selector).match(/\sbackground:\s*([^;]+);/)?.[1];
          expect(background).toBeTruthy();
          const contrast = ratio(foreground!, background!, vars);
          expect(contrast).not.toBeNull();
          expect(contrast!, selector).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it("keeps the gold CTA readable under the dark promo card's descendant override", () => {
    const foreground = block('[data-theme="dark"] .primary-fill-card .button-solid-light *')
      .match(/\scolor:\s*([^;]+);/)?.[1];
    expect(foreground).toBeTruthy();
    for (const selector of [".button-solid-light", ".button-solid-light:hover"]) {
      const background = block(selector).match(/\sbackground:\s*([^;]+);/)?.[1];
      expect(background).toBeTruthy();
      const contrast = ratio(foreground!, background!, dark);
      expect(contrast).not.toBeNull();
      expect(contrast!, selector).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("never renders a color/background pair that passes in light but fails in dark", () => {
    const regressions: string[] = [];

    for (const [selector, body] of rules) {
      if (selector.startsWith("@") || selector.startsWith(":root")) continue;
      if (selector.includes('[data-theme="dark"]')) continue;
      // Member selectors are owned by the four-combo check below, which merges
      // the cascade. Judged here they read as false positives: the base
      // .member-meta-chip rule is (0,1,0) and unreachable — every chip renders
      // inside .member-classroom[data-members-theme], whose (0,3,0) rule
      // re-declares the colour with !important.
      if (selector.includes(".member-")) continue;

      const fg = /(?:^|;|\s)color\s*:\s*([^;]+)/.exec(body)?.[1];
      const bg = /(?:^|;|\s)background(?:-color)?\s*:\s*([^;]+)/.exec(body)?.[1]?.trim();
      if (!fg || !bg || bg.includes("gradient") || bg.includes("url(")) continue;

      const patched = selector.split(",").every((raw) => {
        const part = raw.trim();
        return darkOverrides.has(part) || coveredPrefixes.some((pre) => part.startsWith(pre));
      });
      if (patched) continue;

      const flat = firstColorToken(bg);
      const inDark = ratio(fg, flat, dark);
      const inLight = ratio(fg, flat, light);
      if (inDark === null || inLight === null) continue;

      if (inDark < 4.5 && inLight >= 4.5) {
        regressions.push(`${selector} — light ${inLight.toFixed(2)}:1, dark ${inDark.toFixed(2)}:1`);
      }
    }

    expect(regressions, `dark-only contrast regressions:\n${regressions.join("\n")}`).toEqual([]);
  });
});

// The member area renders under a CROSS PRODUCT of two themes that vary
// INDEPENDENTLY: data-members-theme (per-course, the teacher picks it) and
// data-theme (the student's platform toggle). Member CSS mixes --ma-* with
// platform --color-*, so all four combinations ship. The check above only
// compares light-vs-dark of ONE of them, which is why white-on-green survived
// in both: it failed identically in each, so it never read as a regression.
function anchoredPalette(selector: string): Record<string, string> {
  // Anchored at line start: a bare `[data-members-theme] {` search also matches
  // inside `.member-classroom[data-members-theme] {`, which declares no --ma-*
  // at all. That returns an empty palette, every --ma-* becomes unresolvable,
  // and the whole check silently passes on zero rules.
  const at = new RegExp(`^${selector.replace(/[[\]().*+?^$|\\{}]/g, "\\$&")} \\{`, "m").exec(sheet);
  if (!at) throw new Error(`${selector} block not found`);
  const body = sheet.slice(at.index, sheet.indexOf("\n}", at.index));
  const vars = Object.fromEntries(
    [...body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map(([, k, v]) => [k, v.trim()]),
  );
  if (Object.keys(vars).length === 0) throw new Error(`${selector} parsed to an empty palette`);
  return vars;
}

const maShared = anchoredPalette("[data-members-theme]");
const maLight = { ...maShared, ...anchoredPalette('[data-members-theme="light"]') };
const maDark = { ...maShared, ...anchoredPalette('[data-members-theme="dark"]') };

// Selectors whose real backdrop is NOT the page background, so compositing them
// over --ma-bg is meaningless. Static analysis cannot resolve these; the note is
// the check. Verified in enrolled-course-workspace.tsx.
const UNRESOLVABLE_BACKDROP: Record<string, string> = {
  ".member-dark-stat": "sits inside .member-sidebar-card--dark (:792), a dark gradient card",
  ".member-module-card__now": "absolute badge over an arbitrary course cover image (:923)",
};

const COMBOS = [
  ["course light / platform light", { ...light, ...maLight }, "light", false],
  ["course light / platform dark", { ...dark, ...maLight }, "light", true],
  ["course dark / platform light", { ...light, ...maDark }, "dark", false],
  ["course dark / platform dark", { ...dark, ...maDark }, "dark", true],
] as const;

it("keeps a visible selection outline in a light course under either platform theme", () => {
  const selected = block('.member-classroom[data-members-theme="light"] .member-lesson-card--active');
  const border = /border-color:\s*([^;]+);/.exec(selected)?.[1];
  expect(border).toBeTruthy();
  for (const platform of [light, dark]) {
    const vars = { ...platform, ...maLight };
    for (const surface of ["--ma-surface", "--ma-surface-2"]) {
      expect(ratio(border!, `var(${surface})`, vars, "--ma-bg")).toBeGreaterThanOrEqual(3);
    }
  }
});

/** The key this selector part collapses to, or null if it is dead in this combo. */
function liveKey(part: string, courseTheme: string, platformDark: boolean): string | null {
  if (part.includes('[data-theme="dark"]') && !platformDark) return null;
  if (part.includes('[data-members-theme="light"]') && courseTheme !== "light") return null;
  if (part.includes('[data-members-theme="dark"]') && courseTheme !== "dark") return null;
  return (
    part
      .replaceAll('[data-theme="dark"]', "")
      .replace(/\.member-classroom\[data-members-theme(?:="\w+")?\]/g, "")
      .split(/\s+/)
      .join(" ")
      .trim() || null
  );
}

describe.each(COMBOS)("member area contrast — %s", (_name, vars, courseTheme, platformDark) => {
  it("keeps the selected lesson title readable independently of the platform theme", () => {
    const selector = `.member-classroom[data-members-theme="${courseTheme}"] .member-lesson-card--active .member-lesson-card__title`;
    const body = rules.find(([key]) => key === selector)?.[1] ?? "";
    const foreground = body.match(/\scolor:\s*([^;]+);/)?.[1];
    expect(foreground).toBeTruthy();
    expect(ratio(foreground!, "var(--ma-surface)", vars, "--ma-bg")).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps review heading and body readable across the tinted panel", () => {
    // The generic check below skips gradients and cannot pair inherited text
    // with this panel, which let a white backdrop ship with dark-theme text.
    const background = /background\s*:\s*([^;]+);/.exec(block(".member-review-panel"))?.[1] ?? "";
    const flat = background.slice(background.lastIndexOf(",") + 1).trim();
    const base = parseColor(flat, vars);
    const tint = parseColor(/rgba?\([^)]+\)/.exec(background)?.[0] ?? "", vars);
    if (!base || !tint) throw new Error(`Unresolved review panel background: ${background}`);

    expect(base[3], "review panel surface must remain opaque").toBe(1);
    if (courseTheme === "light") expect(base).toEqual([255, 255, 255, 1]);

    const failures: string[] = [];
    for (const fg of ["var(--ma-ink)", "var(--ma-ink-soft)"]) {
      // Test both ends of the existing translucent radial tint.
      for (const bg of [flat, `rgb(${over(tint, base).join(", ")})`]) {
        const contrast = ratio(fg, bg, vars, "--ma-bg");
        if (contrast === null) throw new Error(`Unresolved review contrast: ${fg} on ${bg}`);
        if (contrast < 4.5) {
          failures.push(`${fg} on ${bg} — ${contrast.toFixed(2)}:1`);
        }
      }
    }
    expect(failures, `review panel below AA:\n${failures.join("\n")}`).toEqual([]);
  });

  // The tab bar painted platform colours on the course's own background (the
  // active tab read ~1.3:1 on a dark course), and the current playlist row lost
  // its meta colour in the cascade (1.04:1 light, 2.7:1 dark). Neither rule
  // declares colour AND background, so the pair check below never sees them.
  it("keeps the classroom tabs and the current lesson's meta line readable", () => {
    const declared = (selector: string, prop: "color" | "background") => {
      let value: string | undefined;
      for (const [key, body] of rules) {
        if (!key.split(",").some((part) => part.trim() === selector)) continue;
        value = new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+)`).exec(body)?.[1]?.trim() ?? value;
      }
      return value;
    };
    for (const selector of [
      ".member-classroom-tabs > a",
      '.member-classroom-tabs > a[aria-current="page"]',
      ".member-classroom-tabs > .member-classroom-tabs__action",
    ]) {
      const fg = declared(selector, "color");
      expect(fg, selector).toBeTruthy();
      expect(ratio(fg!, "var(--ma-bg)", vars, "--ma-bg"), selector).toBeGreaterThanOrEqual(4.5);
    }
    // `.member-classroom[data-members-theme] .member-playlist__lesson-meta`
    // ties the base current-row rule on specificity and comes later, so the
    // current row has to be re-declared at member scope to keep its colour.
    const row = ".member-classroom[data-members-theme] .member-playlist__lesson.is-current";
    const meta = declared(`${row} .member-playlist__lesson-meta`, "color");
    const background = declared(row, "background");
    expect(meta, "current row meta not re-declared at member scope").toBeTruthy();
    expect(ratio(meta!, background!, vars, "--ma-bg")).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps every member color/background pair at or above AA", () => {
    // Merge the cascade rather than skipping overridden selectors: an override
    // can BE the failure (the member-scoped "done" pill re-applied white with
    // !important, which is how it defeated the platform-level dark fix).
    const merged = new Map<string, { fg?: string; bg?: string }>();
    for (const [selector, body] of rules) {
      if (selector.startsWith("@") || !selector.includes("member")) continue;
      const fg = /(?:^|;|\s)color\s*:\s*([^;]+)/.exec(body)?.[1]?.trim();
      const bg = /(?:^|;|\s)background(?:-color)?\s*:\s*([^;]+)/.exec(body)?.[1]?.trim();
      if (!fg && !bg) continue;

      for (const raw of selector.split(",")) {
        const key = liveKey(raw.trim(), courseTheme, platformDark);
        if (!key) continue;
        const entry = merged.get(key) ?? {};
        if (fg) entry.fg = fg;
        if (bg) entry.bg = bg;
        merged.set(key, entry);
      }
    }

    const failures: string[] = [];
    let evaluated = 0;
    for (const [selector, { fg, bg }] of merged) {
      if (!fg || !bg || bg.includes("gradient") || bg.includes("url(")) continue;
      if (selector in UNRESOLVABLE_BACKDROP) continue;
      const r = ratio(fg, firstColorToken(bg), vars, "--ma-bg");
      if (r === null) continue;
      evaluated += 1;
      if (r < 4.5) failures.push(`${selector} — ${r.toFixed(2)}:1 (${fg} on ${bg})`);
    }

    // A guard that silently parses nothing passes forever, and that is exactly
    // how this one shipped green: splitting a background shorthand on every
    // space mangled `rgba(39, 160, 106, .12)`, ratio() returned null, and the
    // rule vanished — not passing, not failing, gone. That cut the real count
    // from 19 to ~13, so the floor sits at 15: high enough to have caught it,
    // low enough that deleting a few member rules will not trip it.
    expect(evaluated, "member guard parsed almost nothing — check the CSS parser").toBeGreaterThan(
      15,
    );
    expect(failures, `member area below AA:\n${failures.join("\n")}`).toEqual([]);
  });
});

// The certificate is downloaded as PDF and shared, so it must stay white in the
// dark theme. The exception that guarantees this existed but did not apply: the
// generic `.bg-white` rule in the dark theme uses `!important`, and `!important` beats
// any normal rule no matter how specific it is. Result: gray paper
// with the exception written in the file. This test fails if the force goes away
// again, or if the exception goes back to talking only about the children.
describe("certificate in the dark theme", () => {
  // Body of the rule whose selector contains `needle`, ignoring extra spaces.
  function ruleWith(needle: string): string {
    const at = css.indexOf(needle);
    expect(at, `selector ${needle} not found`).toBeGreaterThan(-1);
    const open = css.indexOf("{", at);
    return css.slice(open, css.indexOf("}", open));
  }

  it("keeps the certificate exception as strong as the generic rule", () => {
    const generica = ruleWith('[data-theme="dark"] .bg-white {');
    expect(generica, "the generic rule stopped being !important").toContain(
      "!important",
    );

    const excecao = ruleWith('[data-theme="dark"] .cert-doc.bg-white');
    expect(
      excecao,
      "without !important the certificate exception loses to the generic rule",
    ).toContain("!important");
    expect(excecao).toContain("#ffffff");
  });

  it("covers the paper itself, not only what is inside it", () => {
    // <article class="cert-doc ... bg-white"> — the two classes on the SAME
    // element, which is the case the descendant selector never reached.
    for (const selector of [
      '[data-theme="dark"] .cert-doc.bg-white',
      '[data-theme="dark"] .keep-white.bg-white',
    ]) {
      expect(css, `${selector} missing`).toContain(selector);
    }
  });
});

// O ProgressBar (ui/progress-bar.tsx): o preenchimento --color-accent-fg contra
// the --color-line track, composed over the surfaces where the bars sit
// (white and light cards). The brass background gave 1.44:1 in the light theme.
describe.each([["light", light], ["dark", dark]] as const)("ProgressBar fill contrast — %s", (_theme, vars) => {
  it.each(["--color-base", "--color-surface", "--color-surface-soft"])("keeps the fill at 3:1 against the track on %s", (surface) => {
    const contrast = ratio("var(--color-accent-fg)", "var(--color-line)", vars, surface);
    expect(contrast, `track over ${surface} must resolve`).not.toBeNull();
    expect(contrast!, `fill vs track over ${surface}`).toBeGreaterThanOrEqual(3);
  });
});

// The InlineAlert warnings inside the classroom: the classroom paints the background by the
// COURSE theme, and the platform has its own theme. In the four mixes, error and warning
// must read at 4.5:1 over their own background, on any surface of the classroom.
// With a dark platform on a light course, the dark amber gave 1.59:1.
describe.each(COMBOS)("InlineAlert inside the classroom — %s", (_name, vars, courseTheme) => {
  const danger = palette('.member-classroom[data-members-theme] [class*="text-[var(--color-danger-fg)]"]');
  const warning = palette(`.member-classroom[data-members-theme="${courseTheme}"] [class*="text-[var(--color-warning-fg)]"]`);

  it.each([
    ["--color-danger-fg", "--color-danger-soft", danger],
    ["--color-warning-fg", "--color-warning-soft", warning],
  ] as const)("keeps %s on %s at AA over every classroom surface", (foreground, background, remap) => {
    expect(Object.keys(remap).length, "classroom remap not found").toBeGreaterThan(0);
    const merged = { ...vars, ...remap };
    for (const surface of ["--ma-bg", "--ma-elev", "--ma-surface", "--ma-surface-2"]) {
      const contrast = ratio(`var(${foreground})`, `var(${background})`, merged, surface);
      expect(contrast, `${background} over ${surface} must resolve`).not.toBeNull();
      expect(contrast!, `${background} over ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  // The dashed border of the EmptyState uses --color-line-strong, which the classroom did not
  // remap: navy at 40% vanished on a dark course.
  it("remaps the strong border to the course line", () => {
    expect(block('.member-classroom[data-members-theme] [class*="border-[var(--color-line-strong)]"]')).toContain(
      "border-color: var(--ma-line-2) !important;",
    );
  });
});

// The .field-input inside the classroom (message, review, lesson comment):
// with a dark platform, the `!important` background and the focus border of
// [data-theme="dark"] .field-input beat the classroom field rule, and on a
// light course the box came out in the platform's tone. The classroom's own rule
// gives background, border and focus back to the course theme in the four mixes.
describe.each(COMBOS)("house field inside the classroom — %s", (_name, vars) => {
  const field = ".member-classroom[data-members-theme] .field-input";

  it("background, border and focus of .field-input come from the course theme", () => {
    expect(sheet).toMatch(
      /\.member-classroom\[data-members-theme\] \.field-input,\s*\.member-classroom\[data-members-theme\] \.field-input:focus,\s*\.member-classroom\[data-members-theme\] \.field-input:focus-visible \{/,
    );
    const rule = block(`${field}:focus-visible`);
    expect(rule).toContain("border-color: var(--ma-line);");
    // The platform dark background has !important: the classroom one needs it too.
    expect(rule).toContain("background: var(--ma-surface) !important;");
    expect(rule).toContain("color: var(--ma-ink);");
    // It comes after the platform rules, and focus weighs more than the dark one.
    expect(css.indexOf(`${field},`)).toBeGreaterThan(css.indexOf('[data-theme="dark"] .field-input:focus-visible {'));
    expect(ratio("var(--ma-ink)", "var(--ma-surface)", vars, "--ma-bg")).toBeGreaterThanOrEqual(4.5);
  });
});

// The classroom community in the COURSE colors, in the four mixes. Before, the feed
// painted "answered", "live" and "Answer" in a fixed green (3.6:1 on a dark
// course), and the active filter, the "N new posts" pill and the avatars in the platform
// navy (~1.3:1 against the panel of a dark course: the chosen filter
// looked unchosen).
describe.each(COMBOS)("classroom community in the course colors — %s", (_name, vars, courseTheme) => {
  const surfaces = ["--ma-bg", "--ma-elev", "--ma-surface", "--ma-surface-2"];
  const success = palette(`.member-classroom[data-members-theme="${courseTheme}"] [class*="var(--color-success-"]`);
  const inverted = palette(
    '.member-classroom[data-members-theme] .member-lesson-comments [class*="bg-[var(--color-primary)]"]',
  );

  it("reads the success green at 4.5:1 on its own background and directly on the surface", () => {
    expect(Object.keys(success).length, "green remapping not found").toBeGreaterThan(0);
    const merged = { ...vars, ...success };
    for (const surface of surfaces) {
      for (const background of ["var(--color-success-soft)", `var(${surface})`]) {
        const contrast = ratio("var(--color-success-fg)", background, merged, surface);
        expect(contrast, `${background} over ${surface} must resolve`).not.toBeNull();
        expect(contrast!, `${background} over ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("the active filter, the pill and the avatar read the text and stand out from the panel", () => {
    expect(Object.keys(inverted).length, "navy remapping not found").toBeGreaterThan(0);
    const merged = { ...vars, ...inverted };
    for (const surface of surfaces) {
      const label = ratio("var(--color-base)", "var(--color-primary)", merged, surface);
      expect(label, `text over the fill, ${surface}`).not.toBeNull();
      expect(label!).toBeGreaterThanOrEqual(4.5);
      // The fill against the panel: 3:1, the minimum for what is not text.
      const fill = ratio("var(--color-primary)", `var(${surface})`, merged, surface);
      expect(fill!, `fill over ${surface}`).toBeGreaterThanOrEqual(3);
    }
  });
});

// The "live" strip of the classroom (live-session-parts.tsx): background and border in the green
// remapped by the COURSE theme, text in --ma-ink, directly over the
// classroom background (--ma-bg). In the four mixes: text at 4.5:1, border at 3:1.
describe.each(COMBOS)("live strip of the classroom — %s", (_name, vars, courseTheme) => {
  it("reads the text over the green and the border stands out from the classroom background", () => {
    const success = palette(`.member-classroom[data-members-theme="${courseTheme}"] [class*="var(--color-success-"]`);
    expect(Object.keys(success).length, "green remapping not found").toBeGreaterThan(0);
    const merged = { ...vars, ...success };
    const text = ratio("var(--ma-ink)", "var(--color-success-soft)", merged, "--ma-bg");
    expect(text, "strip text").not.toBeNull();
    expect(text!).toBeGreaterThanOrEqual(4.5);
    const border = ratio("var(--color-success-fg)", "var(--ma-bg)", merged, "--ma-bg");
    expect(border!, "strip border").toBeGreaterThanOrEqual(3);
    const soft = ratio("var(--ma-ink-soft)", "var(--color-success-soft)", merged, "--ma-bg");
    expect(soft!, "sentence without a link in the strip").toBeGreaterThanOrEqual(4.5);
  });
});

// Highlight links of the members area (the "← Back to the area" of the community,
// the area home link): now that the color asked of an <a> reaches the screen, they
// ask for --ma-accent-ink. --ma-accent is a button background: 2.9:1 on a dark course.
describe.each(COMBOS)("highlight link of the members area — %s", (_name, vars) => {
  it("--ma-accent-ink reads 4.5:1 on the course background and surface", () => {
    for (const background of ["var(--ma-bg)", "var(--ma-surface)"]) {
      const contrast = ratio("var(--ma-accent-ink)", background, vars, "--ma-bg");
      expect(contrast, `${background} must resolve`).not.toBeNull();
      expect(contrast!, background).toBeGreaterThanOrEqual(4.5);
    }
  });
});

it("the community feed and drawer no longer paint a fixed green", () => {
  for (const file of ["community-feed.tsx", "community-post-drawer.tsx"]) {
    const source = readFileSync(join(process.cwd(), "src/components/learn", file), "utf8");
    expect(source, file).not.toMatch(/rgba?\(2[12],\s*1(28|63),/);
  }
});
