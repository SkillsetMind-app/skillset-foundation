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
