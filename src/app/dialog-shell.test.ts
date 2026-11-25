// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// jsdom does not paint or animate: what is proven here is the RULE of the dialog
// frame, read from the CSS and the code as text (same design as
// onda-d-motion.test.ts and dialog-viewport-fit.test.tsx).
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

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

describe("dialog frame", () => {
  it("a single background, from the token, for the hand-made layer and for the <dialog>", () => {
    expect(css).toContain("--color-scrim: rgba(15, 39, 68, 0.62);");
    expect(css).toMatch(/\n\.dialog-backdrop \{\s*background: var\(--color-scrim\);/);
    // Own rule with a fallback: the old ::backdrop does not inherit variables.
    expect(css).toMatch(
      /\ndialog\.modal-panel::backdrop \{\s*background: var\(--color-scrim, rgba\(15, 39, 68, 0\.62\)\);/,
    );
  });

  it("dialogs that painted their own background use the token's, with no blur", () => {
    for (const file of [
      "learn/course-unlock-modal.tsx",
      "learn/lesson-list-overlay.tsx",
      "learn/welcome-tour.tsx",
      "auth/auth-provider.tsx",
      "teacher/lesson-content-modal.tsx",
    ]) {
      const source = readFileSync(join(process.cwd(), "src", "components", file), "utf8");
      expect(source, file).toContain("dialog-backdrop");
      expect(source, file).not.toContain("backdrop-blur");
    }
    // The lesson studio layer does not repaint the background over the token.
    const studio = css.slice(css.indexOf("\n.lesson-modal-overlay {"), css.indexOf("}", css.indexOf("\n.lesson-modal-overlay {")));
    expect(studio).toContain("position: fixed;");
    expect(studio).not.toMatch(/background|backdrop-filter/);
    // The help sheet is a native <dialog>: same reserve as dialog.modal-panel.
    expect(css).toMatch(
      /\n\.contextual-help-dialog::backdrop \{\s*background: var\(--color-scrim, rgba\(15, 39, 68, 0\.62\)\);/,
    );
  });

  it("on a dark course, inside the classroom, the background darkens too", () => {
    const start = css.indexOf('\n[data-members-theme="dark"] {');
    expect(start).toBeGreaterThan(-1);
    expect(css.slice(start, css.indexOf("\n}", start))).toContain("--color-scrim: rgba(0, 0, 0, 0.6);");
  });

  it("in the dark theme the background darkens (black), instead of tinting navy", () => {
    const start = css.indexOf('[data-theme="dark"] {');
    const dark = css.slice(start, css.indexOf("\n}", start));
    expect(dark).toContain("--color-scrim: rgba(0, 0, 0, 0.6);");
  });

  it("the panel rises and the background lights up in 180ms, only without 'reduce motion'", () => {
    const ranges = noPreferenceRanges();
    const inside = (index: number) => ranges.some(([start, end]) => index > start && index < end);
    const panel = css.search(/\.modal-panel \{\s*animation: motion-panel-in var\(--duration-base\) var\(--ease-standard\) backwards;/);
    const backdrop = css.search(/\.dialog-backdrop \{\s*animation: motion-fade var\(--duration-base\)/);
    const nativeBackdrop = css.search(/dialog\.modal-panel::backdrop \{\s*animation: motion-fade var\(--duration-base\)/);
    for (const at of [panel, backdrop, nativeBackdrop]) {
      expect(at).toBeGreaterThan(-1);
      expect(inside(at)).toBe(true);
    }
  });

  it("one panel and one footer: one shadow, a hairline on top and stack below 640px", () => {
    const panel = css.slice(css.indexOf("  .dialog-panel {"), css.indexOf("}", css.indexOf("  .dialog-panel {")));
    expect(panel).toContain("box-shadow: var(--shadow-strong);");
    expect(panel).toContain("border-radius: var(--radius-xl);");
    const footer = css.slice(css.indexOf("  .dialog-footer {"), css.indexOf("}", css.indexOf("  .dialog-footer {")));
    expect(footer).toContain("border-top: 1px solid var(--color-line);");
    expect(footer).toContain("justify-content: flex-end;");
    // From sm up, a single row, as the confirmation always was.
    expect(footer).not.toContain("flex-wrap");
    // The main one comes last in the code; stacked, column-reverse puts it on
    // top and Cancel at the bottom, where the thumb lands. The same cut (sm) at which
    // the confirmation already stacked.
    expect(css).toMatch(/@media \(width < 640px\) \{\s*\.dialog-footer \{\s*flex-direction: column-reverse;\s*align-items: stretch;/);

    for (const file of [
      "ui/confirm-dialog.tsx",
      "account/billing-tabs.tsx",
      "teacher/course-actions.tsx",
      "learn/welcome-tour.tsx",
      "teacher/teacher-welcome-tour.tsx",
    ]) {
      const source = readFileSync(join(process.cwd(), "src", "components", file), "utf8");
      expect(source, file).toContain("dialog-panel modal-panel");
      expect(source, file).toContain('"dialog-footer');
      // The dialogs' own shadows are gone: it is the panel's.
      expect(source, file).not.toMatch(/shadow-\[(0_24px_60px|0_30px_80px)/);
    }
    for (const file of ["account/totp-mfa-section.tsx", "account/upgrade-modal.tsx", "learn/course-unlock-modal.tsx", "learn/lesson-list-overlay.tsx"]) {
      const source = readFileSync(join(process.cwd(), "src", "components", file), "utf8");
      expect(source, file).toContain("dialog-panel");
      expect(source, file).not.toContain("shadow-[0_30px_80px");
    }
  });

  it("no dialog goes back to painting the black background at 55%", () => {
    const root = join(process.cwd(), "src", "components");
    const offenders = readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".tsx") && !entry.name.includes(".test."))
      .map((entry) => join(entry.parentPath, entry.name))
      .filter((file) => readFileSync(file, "utf8").includes("bg-[rgba(7,9,13,0.55)]"));
    expect(offenders).toEqual([]);
  });

  it("an icon-only button has a 44px target", () => {
    const start = css.search(/\n {2}\.button-icon \{/);
    expect(start).toBeGreaterThan(-1);
    const body = css.slice(start, css.indexOf("}", start));
    expect(body).toContain("width: 2.75rem;");
    expect(body).toContain("height: 2.75rem;");
  });
});
