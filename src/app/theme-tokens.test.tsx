import { readFileSync } from "node:fs";
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

  it("leaves no literal white on platform surfaces that must invert", () => {
    for (const selector of [
      ".platform-hero-card",
      ".studio-welcome-card",
      ".studio-action-card",
      ".learner-home-hero",
      ".credential-hero",
      ".btn-signin",
      ".studio-activity-card",
      ".learner-continue-card",
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

function ratio(fg: string, bg: string, vars: Record<string, string>): number | null {
  const base = parseColor(vars["--color-base"], vars);
  const fgColor = parseColor(fg, vars);
  const bgColor = parseColor(bg, vars);
  if (!base || !fgColor || !bgColor) return null;

  const backdrop = bgColor[3] < 1 ? over(bgColor, base) : bgColor.slice(0, 3);
  const text = fgColor[3] < 1 ? over(fgColor, backdrop) : fgColor.slice(0, 3);
  const [hi, lo] = [luminance(text), luminance(backdrop)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
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
  it("never renders a color/background pair that passes in light but fails in dark", () => {
    const regressions: string[] = [];

    for (const [selector, body] of rules) {
      if (selector.startsWith("@") || selector.startsWith(":root")) continue;
      if (selector.includes('[data-theme="dark"]')) continue;

      const fg = /(?:^|;|\s)color\s*:\s*([^;]+)/.exec(body)?.[1];
      const bg = /(?:^|;|\s)background(?:-color)?\s*:\s*([^;]+)/.exec(body)?.[1]?.trim();
      if (!fg || !bg || bg.includes("gradient") || bg.includes("url(")) continue;

      const patched = selector.split(",").every((raw) => {
        const part = raw.trim();
        return darkOverrides.has(part) || coveredPrefixes.some((pre) => part.startsWith(pre));
      });
      if (patched) continue;

      const flat = bg.includes(" ") ? bg.split(" ")[0] : bg;
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

const COMBOS = [
  ["course light / platform light", { ...light, ...maLight }, "light", false],
  ["course light / platform dark", { ...dark, ...maLight }, "light", true],
  ["course dark / platform light", { ...light, ...maDark }, "dark", false],
  ["course dark / platform dark", { ...dark, ...maDark }, "dark", true],
] as const;

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
    for (const [selector, { fg, bg }] of merged) {
      if (!fg || !bg || bg.includes("gradient") || bg.includes("url(")) continue;
      const r = ratio(fg, bg.includes(" ") ? bg.split(" ")[0] : bg, vars);
      if (r !== null && r < 4.5) failures.push(`${selector} — ${r.toFixed(2)}:1 (${fg} on ${bg})`);
    }

    expect(failures, `member area below AA:\n${failures.join("\n")}`).toEqual([]);
  });
});
