import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Motion that only exists in the CSS: jsdom animates nothing, so what is proven
// here is the RULE — that the property transitions, and with what delay. Same
// design as theme-tokens.test.tsx.
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

function block(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} not found in globals.css`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("\n}", start));
}

describe("the classroom progress bar", () => {
  // Completing a lesson rewrote the width at once: the bar JUMPED to the
  // new mark and the only signal of "that counted" went unnoticed. Today the top
  // bar is the house ProgressBar (F-09), which slides to the new mark by
  // transform, only for those who did not ask for less motion.
  it("slides to the new mark instead of jumping", () => {
    const workspace = readFileSync(join(process.cwd(), "src/components/learn/enrolled-course-workspace.tsx"), "utf8");
    expect(workspace).toMatch(/<ProgressBar\s[\s\S]{0,300}?className="member-classroom-head__progress"/);
    const bar = readFileSync(join(process.cwd(), "src/components/ui/progress-bar.tsx"), "utf8");
    expect(bar).toContain("motion-safe:transition-transform");
    // The hand-made width rule left with the old bar.
    expect(css).not.toContain(".member-classroom-head__progress > span");
  });
});

describe("the sidebar labels", () => {
  // Wave E: the rail width switches instantly (animating the column redid the page
  // layout on every frame), and the label only lights up. Before, the width took
  // 240ms and the label waited 180ms so as not to run over it.
  it("outside no-preference the label does not animate; inside, only the opacity, in 180ms", () => {
    expect(block(".platform-sidebar-label")).not.toContain("transition");
    const motion = css.slice(css.indexOf("/* 14. Side menu (wave E)."));
    expect(motion.slice(0, 600)).toMatch(
      /\.platform-sidebar-label \{\s*transition: opacity var\(--duration-base\) var\(--ease-standard\);/,
    );
    const opener = css.lastIndexOf("@media (prefers-reduced-motion: no-preference) {", css.indexOf("/* 14. Side menu"));
    expect(opener).toBeGreaterThan(-1);
  });

  it("with prefers-reduced-motion nothing moves: the global block zeroes the transitions", () => {
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/transition-duration: 0\.01ms !important;/);
  });
});

describe("the 'Next lesson' card", () => {
  // It appeared flat over the video and disappeared the same way.
  // Enter and exit on the system time (180ms), not the 250ms from before.
  it("enters rising with a fade", () => {
    expect(block(".member-next-lesson")).toMatch(
      /animation: member-next-lesson-in var\(--duration-base\) var\(--ease-standard\)/,
    );
    const keyframes = css.slice(css.indexOf("@keyframes member-next-lesson-in"));
    expect(keyframes.slice(0, 200)).toContain("translateY(12px)");
  });

  it("leaves going down — and the entrance is canceled, otherwise the fill held the state", () => {
    const leaving = block(".member-next-lesson.is-leaving");
    expect(leaving).toContain("animation: none");
    expect(leaving).toContain("transform: translateY(12px)");
    expect(leaving).toMatch(/transition:\s*\n?\s*opacity var\(--duration-base\) var\(--ease-standard\)/);
  });

  // With the mini player on, the card was born inside the ~150x84px video.
  it("with the mini player on it becomes a strip right below it", () => {
    const media = css.lastIndexOf(
      "@media (max-width: 767.98px) {",
      css.indexOf(".member-video-dock--mini .member-video-stage:has(> .member-next-lesson) > .member-next-lesson {"),
    );
    expect(media).toBeGreaterThan(-1);
    expect(block(".member-video-dock--mini .member-video-stage:has(> .member-next-lesson)")).toContain("position: static;");
    // Both halves under the same :has(): without support, both fall together and
    // the card stays where it was (without this it went below the stage, which
    // clips what goes past the edge, and disappeared).
    expect(css).not.toContain(".member-video-dock--mini .member-next-lesson {");
    const strip = block(".member-video-dock--mini .member-video-stage:has(> .member-next-lesson) > .member-next-lesson");
    expect(strip).toContain("top: 100%;");
    expect(strip).toContain("bottom: auto;");
  });
});

describe("the classroom frame", () => {
  // overflow: hidden made the classroom a scroll container: the "Mark
  // complete & next" bar, the lesson list and the new-posts notice stuck to it
  // and scrolled along with the page. clip cuts the corners without that.
  it("clips the corners with clip, so the sticky sticks to the screen", () => {
    expect(block(".member-classroom[data-members-theme]")).toMatch(/overflow: clip;/);
  });

  // The old margins targeted direct children of the classroom and stopped matching
  // when the tab wrapper came in: the cards touched the edge and, on the
  // phone, the video went 14px past each side of the screen.
  it("the tab wrapper gives 24px of breathing room (14px on the phone, what the edge-to-edge video discounts)", () => {
    expect(block(".member-classroom[data-members-theme] > .member-classroom-body")).toContain("padding: 0 24px 24px;");
    expect(css).toMatch(/\.member-classroom\[data-members-theme\] > \.member-classroom-body \{\s*padding: 0 14px 14px;/);
    expect(css).toMatch(/\.member-video-dock \{\s*margin-inline: -31px;/);
  });

  // The waiting box was 260-520px and the player that arrives is 16:9: the lesson
  // jumped when the video appeared.
  // The bar pinned at the bottom (~69px) hid the item focused by Tab (WCAG 2.4.11).
  it("with the lesson open, the focus scroll goes above the pinned bar", () => {
    const [, padding] = css.match(/html:has\(#member-lesson-player\) \{\s*scroll-padding-bottom: (\d+)px;/)!;
    expect(Number(padding)).toBeGreaterThanOrEqual(69);
  });

  // The bar scrolls sideways and clips what goes past the edge: the focus ring (2px
  // + 3px offset) of the first tab disappeared on the left.
  it("the tab bar has inner slack for the focus ring", () => {
    const [, padding] = block(".member-classroom[data-members-theme] > .member-classroom-tabs").match(/padding-inline: (\d+)px;/)!;
    expect(Number(padding)).toBeGreaterThanOrEqual(5);
  });

  // "Watch now": the icon took the color of the platform rule and the label that of the
  // course, each in its own way.
  it("icon and label of the classroom filled button use the same course color", () => {
    expect(css).toMatch(
      /\.member-classroom\[data-members-theme\] \.button-solid \*,[\s\S]{0,200}?\{\s*color: var\(--ma-on-accent\) !important;/,
    );
  });

  // Fixed red glow under every filled button, and outline with a red hover,
  // even on a green or blue course.
  it("classroom buttons without fixed red: navy shadow and highlight in the course color", () => {
    expect(block(".member-classroom[data-members-theme] .button-accent:hover")).toContain(
      "box-shadow: var(--shadow-button-strong);",
    );
    expect(css).toMatch(
      /\.member-classroom\[data-members-theme\] \.button-accent \{[^}]*box-shadow: var\(--shadow-button\);/,
    );
    expect(block(".member-classroom[data-members-theme] .button-outline:hover")).toContain(
      "background: color-mix(in srgb, var(--ma-accent) 10%, transparent);",
    );
  });

  it("classroom leftovers of 160/200ms on the system time", () => {
    expect(block(".member-playlist__chevron")).toContain("transform var(--duration-base) var(--ease-standard)");
    expect(css).toMatch(/animation: member-video-mini-in var\(--duration-base\) var\(--ease-standard\);/);
  });

  it("the video waiting box already has the player's 16:9", () => {
    const loading = block(".member-video-empty--loading");
    expect(loading).toContain("aspect-ratio: 16 / 9;");
    expect(loading).toContain("min-height: 0;");
  });
});

describe("the question drawer", () => {
  it("background through the surface token (follows the theme), on the popups layer", () => {
    expect(css).toMatch(/\.community-drawer \{[^}]*background: var\(--color-surface\);/);
    expect(css).not.toMatch(/\.community-drawer(__reply)? \{[^}]*background: #ffffff;/);
    expect(css).toMatch(/\.community-drawer-backdrop \{[^}]*z-index: 70;/);
  });

  it("inside the classroom it reads the course palette, like its text", () => {
    const rule = block(".member-classroom[data-members-theme] .community-drawer");
    expect(rule).toContain("--color-surface: var(--ma-surface);");
    expect(rule).toContain("--color-ink: var(--ma-ink);");
    expect(rule).toContain("--color-line: var(--ma-line);");
    // Error and "answered": on the dark course the platform's red and green
    // gave ~2.7:1. Applies to the drawer and to the classroom feed cards.
    expect(css).toMatch(
      /\.member-classroom\[data-members-theme\] \.community-drawer,\s*\.member-classroom\[data-members-theme\] \[data-community-item\] \{\s*--color-danger-fg: var\(--ma-accent-ink\);\s*--color-success-fg: var\(--ma-success-ink\);/,
    );
  });

  it("enters sliding, only in no-preference", () => {
    const use = css.indexOf("animation: community-drawer-in var(--duration-base) var(--ease-standard) backwards;");
    expect(use).toBeGreaterThan(-1);
    const opener = css.lastIndexOf("@media (prefers-reduced-motion: no-preference) {", use);
    expect(opener).toBeGreaterThan(-1);
    expect(use - opener).toBeLessThan(400);
    expect(css).toMatch(/@keyframes community-drawer-in \{\s*from \{\s*opacity: 0;\s*transform: translateX\(16px\);/);
  });
});
