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
    expect(css).toMatch(/\n\.dialog-backdrop \{\s*background: var\(--color-scrim\);/);
    // Regra própria e com reserva: o ::backdrop antigo não herda variáveis.
    expect(css).toMatch(
      /\ndialog\.modal-panel::backdrop \{\s*background: var\(--color-scrim, rgba\(15, 39, 68, 0\.62\)\);/,
    );
  });

  it("as janelas que pintavam um fundo próprio usam o do token, sem desfoque", () => {
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
    // A camada do estúdio da aula não repinta o fundo por cima do token.
    const studio = css.slice(css.indexOf("\n.lesson-modal-overlay {"), css.indexOf("}", css.indexOf("\n.lesson-modal-overlay {")));
    expect(studio).toContain("position: fixed;");
    expect(studio).not.toMatch(/background|backdrop-filter/);
    // A folha de ajuda é um <dialog> nativo: mesma reserva do dialog.modal-panel.
    expect(css).toMatch(
      /\n\.contextual-help-dialog::backdrop \{\s*background: var\(--color-scrim, rgba\(15, 39, 68, 0\.62\)\);/,
    );
  });

  it("num curso escuro, dentro da sala, o fundo também escurece", () => {
    const start = css.indexOf('\n[data-members-theme="dark"] {');
    expect(start).toBeGreaterThan(-1);
    expect(css.slice(start, css.indexOf("\n}", start))).toContain("--color-scrim: rgba(0, 0, 0, 0.6);");
  });

  it("no tema escuro o fundo escurece (preto), em vez de tingir de navy", () => {
    const start = css.indexOf('[data-theme="dark"] {');
    const dark = css.slice(start, css.indexOf("\n}", start));
    expect(dark).toContain("--color-scrim: rgba(0, 0, 0, 0.6);");
  });

  it("o painel sobe e o fundo acende em 180ms, só sem 'reduzir movimento'", () => {
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
