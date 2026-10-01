import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { brand } from "@/data/brand";
import { ThemeProvider } from "@/lib/theme/theme-provider";

const read = (url: string) => readFileSync(join(process.cwd(), "public", url), "utf8");

// The dark theme showed the logo as navy on a dark background. These pin the
// two causes that can bring it back.
describe("brand logo", () => {
  const themed = [
    ["logoFullLight", brand.logoFullLight, "#102a43"],
    ["logoMarkLight", brand.logoMarkLight, "#102a43"],
    ["logoFullDark", brand.logoFullDark, "#ffffff"],
    ["logoMarkDark", brand.logoMarkDark, "#ffffff"],
  ] as const;

  it.each(themed)("%s is a transparent vector in the right colour", (_, url, colour) => {
    expect(url).toMatch(/\.svg$/);
    expect(existsSync(join(process.cwd(), "public", url))).toBe(true);

    const svg = read(url);
    // A background <rect> paints a navy box behind the mark on dark surfaces.
    expect(svg).not.toMatch(/<rect\b/i);
    // Outlines only: a <text> element would depend on the visitor's fonts.
    expect(svg).not.toMatch(/<text\b/i);
    const fills = new Set([...svg.matchAll(/fill="(#[0-9a-f]{6})"/gi)].map((m) => m[1].toLowerCase()));
    expect([...fills]).toEqual([colour]);
  });

  it("keeps the theme on <html> when the platform provider unmounts", () => {
    window.localStorage.setItem("skillset_theme", "dark");
    const { unmount } = render(<ThemeProvider><span /></ThemeProvider>);
    expect(document.documentElement.dataset.theme).toBe("dark");

    // Leaving the platform for a public page unmounts the provider. Dropping
    // the attribute there flipped the page, and its logo, to the light palette.
    unmount();
    expect(document.documentElement.dataset.theme).toBe("dark");
    window.localStorage.removeItem("skillset_theme");
  });
});
