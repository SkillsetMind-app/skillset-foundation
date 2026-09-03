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

  // O anel de foco mudava de cor por tela: a regra global usava --color-primary
  // e 13 elementos pintavam o navy antigo (rgba(44,82,130,.24/.28/.35)) inline.
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

// O certificado é baixado em PDF e compartilhado, então tem de ficar branco no
// tema escuro. A exceção que garante isso existia mas não valia: a regra
// genérica de `.bg-white` no tema escuro usa `!important`, e `!important` ganha
// de qualquer regra normal por mais específica que ela seja. Resultado: papel
// cinza com a exceção escrita no arquivo. Este teste falha se a força sumir de
// novo, ou se a exceção voltar a falar só dos filhos.
describe("certificado no tema escuro", () => {
  // Corpo da regra cujo seletor contém `needle`, ignorando espaços de sobra.
  function ruleWith(needle: string): string {
    const at = css.indexOf(needle);
    expect(at, `seletor ${needle} não encontrado`).toBeGreaterThan(-1);
    const open = css.indexOf("{", at);
    return css.slice(open, css.indexOf("}", open));
  }

  it("mantém a exceção do certificado com a mesma força da regra genérica", () => {
    const generica = ruleWith('[data-theme="dark"] .bg-white {');
    expect(generica, "a regra genérica deixou de ser !important").toContain(
      "!important",
    );

    const excecao = ruleWith('[data-theme="dark"] .cert-doc.bg-white');
    expect(
      excecao,
      "sem !important a exceção do certificado perde para a regra genérica",
    ).toContain("!important");
    expect(excecao).toContain("#ffffff");
  });

  it("cobre o próprio papel, não só o que está dentro dele", () => {
    // <article class="cert-doc ... bg-white"> — as duas classes no MESMO
    // elemento, que é o caso que o seletor de descendente nunca alcançou.
    for (const selector of [
      '[data-theme="dark"] .cert-doc.bg-white',
      '[data-theme="dark"] .keep-white.bg-white',
    ]) {
      expect(css, `${selector} ausente`).toContain(selector);
    }
  });
});
