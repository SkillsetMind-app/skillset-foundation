// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// jsdom não pinta nem anima: o que se prova aqui é a REGRA da moldura das
// janelas, lida do CSS e do código como texto (mesmo desenho de
// onda-d-motion.test.ts e dialog-viewport-fit.test.tsx).
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

describe("moldura das janelas", () => {
  it("um fundo só, do token, para a camada feita à mão e para o <dialog>", () => {
    expect(css).toContain("--color-scrim: rgba(15, 39, 68, 0.62);");
    expect(css).toMatch(/\.dialog-backdrop,\s*dialog\.modal-panel::backdrop \{\s*background: var\(--color-scrim\);/);
  });

  it("o painel sobe e o fundo acende em 180ms, só sem 'reduzir movimento'", () => {
    const ranges = noPreferenceRanges();
    const inside = (index: number) => ranges.some(([start, end]) => index > start && index < end);
    const panel = css.search(/\.modal-panel \{\s*animation: motion-panel-in var\(--duration-base\) var\(--ease-standard\) backwards;/);
    const backdrop = css.search(/\.dialog-backdrop,\s*dialog\.modal-panel::backdrop \{\s*animation: motion-fade var\(--duration-base\)/);
    expect(panel).toBeGreaterThan(-1);
    expect(backdrop).toBeGreaterThan(-1);
    expect(inside(panel)).toBe(true);
    expect(inside(backdrop)).toBe(true);
  });

  it("nenhuma janela volta a pintar o fundo preto a 55%", () => {
    const root = join(process.cwd(), "src", "components");
    const offenders = readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".tsx") && !entry.name.includes(".test."))
      .map((entry) => join(entry.parentPath, entry.name))
      .filter((file) => readFileSync(file, "utf8").includes("bg-[rgba(7,9,13,0.55)]"));
    expect(offenders).toEqual([]);
  });

  it("botão só de ícone tem alvo de 44px", () => {
    const start = css.search(/\n {2}\.button-icon \{/);
    expect(start).toBeGreaterThan(-1);
    const body = css.slice(start, css.indexOf("}", start));
    expect(body).toContain("width: 2.75rem;");
    expect(body).toContain("height: 2.75rem;");
  });
});
