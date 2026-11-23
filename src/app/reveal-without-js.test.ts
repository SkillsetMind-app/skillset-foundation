// @vitest-environment node
//
// A source-level guard: jsdom runs JavaScript, so a render test cannot show
// what a visitor without it sees. The homepage used to be born invisible —
// every .reveal-on-view section started at opacity 0 and only JS lifted it.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function read(...parts: string[]): string {
  return readFileSync(join(process.cwd(), "src", ...parts), "utf8");
}

describe("sections are visible without JavaScript", () => {
  it("hides .reveal-on-view only once html.js is stamped", () => {
    const css = read("app", "globals.css");
    const start = css.indexOf(".reveal-on-view {");
    const baseRule = css.slice(start, css.indexOf("}", start));

    expect(baseRule).not.toContain("opacity: 0");
    expect(baseRule).toContain("opacity 300ms");
    // Nem antes da hidratação: o html.js sozinho não esconde mais nada. Só a
    // seção que o useRevealOnView armou (montada, abaixo da tela) começa
    // escondida; o comportamento está em reveal-section.test.tsx.
    expect(css).toContain("html.js .reveal-on-view--armed:not(.reveal-on-view--in)");
    expect(css).not.toMatch(/html\.js \.reveal-on-view:not\(\.reveal-on-view--in\)\s*\{/);
  });

  it("stamps html.js from the inline head script", () => {
    expect(read("app", "layout.tsx")).toContain(
      'document.documentElement.classList.add("js")',
    );
  });
});
