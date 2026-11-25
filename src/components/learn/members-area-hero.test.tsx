import { readFileSync } from "node:fs";
import { join } from "node:path";

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MembersAreaHero } from "@/components/learn/members-area-hero";

describe("MembersAreaHero", () => {
  it("renders the title and reflects the theme prop", () => {
    const { container } = render(
      <MembersAreaHero theme="light" title="Brand Design Atelier" />,
    );

    expect(screen.getByText("Brand Design Atelier")).toBeInTheDocument();
    expect(
      container.querySelector('[data-members-theme="light"]'),
    ).not.toBeNull();
  });

  it("renders fallback art (not a broken img) when no cover is set", () => {
    const { container } = render(
      <MembersAreaHero
        theme="dark"
        title="Untitled"
        studioName="Marie Curie Studio"
      />,
    );

    expect(container.querySelector(".members-hero__cover")).toBeNull();
    expect(container.querySelector(".members-hero__art")).not.toBeNull();
    expect(screen.getByText("MC")).toBeInTheDocument();
  });

  it("omits the progress bar when progressPercent is null", () => {
    const { container, rerender } = render(
      <MembersAreaHero theme="dark" title="Course" progressPercent={null} />,
    );
    expect(container.querySelector(".members-hero__prog")).toBeNull();

    rerender(
      <MembersAreaHero theme="dark" title="Course" progressPercent={42} />,
    );
    expect(container.querySelector(".members-hero__prog")).not.toBeNull();
    expect(screen.getByText("42%")).toBeInTheDocument();
  });
});

// Before, "Show more" appeared under any description, even a one-line one.
// jsdom does not do layout: the clipped height (2 lines) and the full-text height come
// from the spy.
describe("MembersAreaHero — 'Show more' only with clipped text", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function heights(scroll: number, client: number) {
    vi.spyOn(Element.prototype, "scrollHeight", "get").mockReturnValue(scroll);
    vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(client);
  }

  it("text that fits in 2 lines: no button", () => {
    heights(50, 50);
    render(<MembersAreaHero theme="dark" title="Course" description="One short line." />);
    expect(screen.getByText("One short line.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("clipped text: 'Show more' opens and becomes 'Show less'", () => {
    heights(120, 50);
    render(<MembersAreaHero theme="dark" title="Course" description="A long description." />);
    const toggle = screen.getByRole("button", { name: "Show more" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Show less" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("A long description.")).toHaveClass("members-hero__sub--full");
  });
});

// jsdom does not do layout: the fit to the canvas is a CSS rule, and the only way to
// pin it down is to read the stylesheet — the same pattern as theme-tokens.test.tsx.
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

function rule(selector: string): string {
  const start = css.indexOf(`\n${selector} {`);
  expect(start, `${selector} is not in globals.css`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("\n}", start));
}

describe("MembersAreaHero — fit to the desktop canvas", () => {
  // Measured in production (07/09, 1920×912): the hero was effectively 520px, the
  // same at 1366×768, and it pushed the "Preview mode" strip and the tabs off
  // the screen. The height is now a slice of the viewport, with a floor and a ceiling.
  it("has a height proportional to the viewport, not a fixed 520px", () => {
    const hero = rule(".members-hero");
    expect(hero).toMatch(/min-height:\s*clamp\(300px, min\(43vw, 48svh\), 520px\)/);
    expect(hero).not.toMatch(/(?:^|\s)height:/);
  });

  it("leaves the phone as it was: below 980px the box follows the content", () => {
    expect(css).toMatch(/@media \(max-width: 980px\) \{\s*\.members-hero \{\s*min-height: 0;/);
  });

  it("crops the cover keeping the top third, where the faces are", () => {
    const { container } = render(
      <MembersAreaHero theme="dark" title="Course" coverUrl="https://cdn.test/cover.jpg" />,
    );
    expect(container.querySelector("img.members-hero__cover")).not.toBeNull();
    expect(rule(".members-hero__cover")).toMatch(/object-position:\s*50% 20%/);
  });

  it("anchors the text to the bottom of the hero, with 40px of breathing room", () => {
    const { container } = render(<MembersAreaHero theme="dark" title="Course" />);
    expect(container.querySelector(".members-hero__inner")).not.toBeNull();
    const inner = rule(".members-hero__inner");
    expect(inner).toMatch(/align-self:\s*flex-end/);
    expect(inner).toMatch(/padding:\s*40px 56px/);
  });

  it("darkens the bottom enough for white text to read over any photo", () => {
    // Worst case, a white photo. Dark: rgba(7,9,13,.92) over #fff gives (27,29,32)
    // → 16.9:1 on the title, 11.7:1 on the description at 82% white. Light:
    // rgba(8,20,38,.86) → (43,53,68) → ~12:1 and ~9:1. AA asks for 4.5:1, and the
    // horizontal gradient still adds on top. Below 0.85 the math fails.
    for (const theme of ["dark", "light"]) {
      const scrim = rule(`[data-members-theme="${theme}"]`).match(/--ma-hero-scrim:([^;]+);/)?.[1];
      expect(scrim, `${theme} without --ma-hero-scrim`).toBeTruthy();
      const bottom = /linear-gradient\(0deg,\s*rgba\(\d+, \d+, \d+, (0\.\d+)\)/.exec(scrim!);
      expect(bottom, `${theme}: vertical gradient without an initial stop`).not.toBeNull();
      expect(Number(bottom![1]), theme).toBeGreaterThanOrEqual(0.85);
    }
  });

  it("gives 'see more' a 44px target", () => {
    expect(rule(".members-hero__more")).toMatch(/min-height:\s*44px/);
  });
});
