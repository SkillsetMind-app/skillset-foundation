import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// A disabled button must not look clickable. jsdom has no hover or layout,
// so what is proven here is the CSS RULE (same design as onda-d-motion).
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

const variants = [
  "button-solid",
  "button-outline",
  "button-accent",
  "button-danger",
  "button-solid-light",
  "button-outline-light",
];
// The .button-icon (icon-only button) also enters the central rule: blocked
// cursor and the same 60%. It stays out of `variants` because it lives in a layer and
// has its own rest rule (tested in the cascade).
const rule = `:is(${[...variants, "button-icon"].map((variant) => `.${variant}`).join(", ")}):is(:disabled, [aria-disabled="true"]) {`;

describe("a disabled button does not react to the mouse or to the click", () => {
  it("stays still, with no shadow and with the blocked cursor", () => {
    const start = css.indexOf(rule);
    expect(start).toBeGreaterThan(-1);
    const body = css.slice(start, css.indexOf("}", start));
    expect(body).toContain("cursor: not-allowed;");
    expect(body).toContain("transform: none;");
    expect(body).toContain("box-shadow: none;");
  });

  // The rule has the same specificity as the :hover and :active of each variant:
  // it only works because it comes after them. Moving one of them below it brings back the
  // disabled button that rises and sinks.
  it.each(variants)("comes after the :hover of .%s and the press-down on click", (variant) => {
    const start = css.indexOf(rule);
    const hover = css.indexOf(`.${variant}:hover {`);
    expect(hover).toBeGreaterThan(-1);
    expect(start).toBeGreaterThan(hover);
    expect(start).toBeGreaterThan(css.indexOf(".button-solid:active,"));
  });

  // There were five opacities (30, 40, 50, 60, 70%) written in each call.
  it("has a single opacity, in the central rule", () => {
    const start = css.indexOf(rule);
    const body = css.slice(start, css.indexOf("}", start));
    expect(body).toContain("opacity: 0.6;");
  });

  // The hover changed the background of the faded button (darker navy, light gray).
  // Each variant repeats the rest background in a disabled rule that comes
  // after its own :hover, with the same specificity.
  it.each(variants)("on hover, a disabled .%s keeps the rest background", (variant) => {
    const declaration = (selector: string, prop: string) => {
      const at = css.search(new RegExp(`\\n${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{`));
      expect(at, `${selector} not found`).toBeGreaterThan(-1);
      const body = css.slice(at, css.indexOf("}", at));
      return body.match(new RegExp(`\\s${prop}:\\s*([^;]+);`))?.[1];
    };
    const disabled = `.${variant}:is(:disabled, [aria-disabled="true"])`;
    const resting = declaration(`.${variant}`, "background");
    expect(resting).toBeTruthy();
    expect(declaration(disabled, "background")).toBe(resting);
    expect(css.indexOf(`\n${disabled} {`)).toBeGreaterThan(css.indexOf(`.${variant}:hover {`));
  });

  it("the full red of delete stays red when disabled", () => {
    const at = css.indexOf('.button-danger.button-danger-solid:is(:disabled, [aria-disabled="true"]) {');
    expect(at).toBeGreaterThan(css.indexOf(".button-danger.button-danger-solid:hover {"));
    expect(css.slice(at, css.indexOf("}", at))).toContain("background: var(--color-danger);");
  });

  // Rules that weigh the same or more than the disabled one and came before it:
  // each one needs a disabled one AFTER, at the same weight. In the dark, the
  // faded "Delete" got the light theme's border; the large "Back" went from
  // gray to navy on hover. (The real cascade is in button-sizes-cascade.)
  it.each([
    ['[data-theme="dark"] .button-danger {', '[data-theme="dark"] .button-danger:is(:disabled, [aria-disabled="true"]) {'],
    ['[data-theme="dark"] .button-outline:hover {', '[data-theme="dark"] .button-outline:is(:disabled, [aria-disabled="true"]) {'],
    [".button-outline.button-lg:hover {", '.button-outline.button-lg:is(:disabled, [aria-disabled="true"]) {'],
    [".member-classroom[data-members-theme] .button-outline:hover {", '.member-classroom[data-members-theme] .button-outline:is(:disabled, [aria-disabled="true"]) {'],
  ])("%s has the disabled rule after it", (before, after) => {
    expect(css.indexOf(before)).toBeGreaterThan(-1);
    expect(css.indexOf(after)).toBeGreaterThan(css.indexOf(before));
  });

  // The central rule beats the utility (it stays outside any layer), so the call's
  // utility only created the fifth variation. It does not come back.
  it("no .button-* button writes its own disabled opacity", () => {
    const dir = join(process.cwd(), "src");
    const pending = new Set<string>();
    const files = readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() &&
          entry.name.endsWith(".tsx") &&
          !entry.name.endsWith(".test.tsx") &&
          !pending.has(entry.name),
      )
      .map((entry) => join(entry.parentPath, entry.name));
    const both =
      /["'`](?=[^"'`]*\bbutton-(?:solid|outline|accent|danger|icon)\b)(?=[^"'`]*\b(?:aria-)?disabled:opacity-\d+)[^"'`]*["'`]/g;
    const violations: string[] = [];
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(both)) {
        violations.push(`${file}: ${match[0]}`);
      }
    }
    expect(violations).toEqual([]);
  });
});

// C-11: the signup interview "Back" was the last hand-made button at 40%.
describe("hand-made signup buttons", () => {
  it("the interview Back and Skip fade at the same 60%", () => {
    const source = readFileSync(join(process.cwd(), "src/components/auth/onboarding-wizard.tsx"), "utf8");
    const opacities = [...source.matchAll(/\bdisabled:opacity-(\d+)\b/g)].map((match) => match[1]);
    expect(opacities.length).toBeGreaterThan(0);
    expect(new Set(opacities)).toEqual(new Set(["60"]));
  });

  // The fourth option when three have already been chosen (interview) and the plan that
  // is not available (plan cards) faded at 50% and 55%.
  it("the choice that cannot be made fades at the same 60%", () => {
    for (const file of ["src/components/auth/onboarding-wizard.tsx", "src/components/shared/plan-selector-cards.tsx"]) {
      const source = readFileSync(join(process.cwd(), file), "utf8");
      const opacities = [...source.matchAll(/\bcursor-not-allowed opacity-(\d+)\b/g)].map((match) => match[1]);
      expect(opacities, file).toEqual(["60"]);
    }
  });
});
