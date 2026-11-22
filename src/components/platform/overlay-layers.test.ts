import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

// A barra lateral da plataforma fica em z-index 65 (acima da topbar, 60).
// Uma janela de tela cheia abaixo disso aparece com o começo das linhas
// escondido atrás da barra: foi o que aconteceu com o aviso de termos (z-50)
// e com os tours de boas-vindas (z-60). O site público não tem barra lateral.
const root = join(process.cwd(), "src", "components");
const PUBLIC_SITE = "site";

const sidebarZ = (() => {
  const css = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");
  const block = css.match(/^\.platform-sidebar \{([\s\S]*?)^\}/m)?.[1] ?? "";
  return Number(block.match(/z-index:\s*(\d+)/)?.[1]);
})();

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.name.endsWith(".tsx") && !entry.name.includes(".test.") ? [path] : [];
  });
}

describe("camadas das janelas de tela cheia", () => {
  it("lê o z-index da barra lateral no CSS", () => {
    expect(sidebarZ).toBeGreaterThan(0);
  });

  const overlays = tsxFiles(root)
    .filter((file) => relative(root, file).split(/[\\/]/)[0] !== PUBLIC_SITE)
    .flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/fixed inset-0 z-(?:\[(\d+)\]|(\d+))/g)].map(
        (m) => [relative(root, file), Number(m[1] ?? m[2])] as const,
      ),
    );

  // Lista vazia vira zero testes e passa calada: o padrão de classe mudou.
  it("acha as janelas de tela cheia", () => {
    expect(overlays.length).toBeGreaterThan(0);
  });

  it.each(overlays)("%s fica acima da barra lateral (z %i)", (_, z) => {
    expect(z).toBeGreaterThan(sidebarZ);
  });
});

// O teste acima só lê "fixed inset-0 z-" escrito no componente. Ficavam de
// fora as camadas feitas por classe do CSS (estúdio da aula, gaveta da
// comunidade, faixa "Rascunho salvo") e o que não cobre a tela inteira, como
// o cartão de envio do vídeo, que em z 90 ficava por cima de toda janela.
// Aqui a escala com nome do :root é a régua, e cada camada é lida no CSS.
describe("escala de camadas com nome", () => {
  // Sem comentários: o do topo cita "z-index: 1" no meio do texto.
  const css = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rootBlock = css.slice(css.indexOf(":root {"), css.indexOf("\n}", css.indexOf(":root {")));
  const layers: Record<string, number> = Object.fromEntries(
    [...rootBlock.matchAll(/--z-([a-z-]+):\s*(\d+);/g)].map((m) => [m[1], Number(m[2])]),
  );

  // z-index da 1ª regra do seletor; aceita número ou var(--z-...).
  function zOf(selector: string): number {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const body = css.match(new RegExp(`^\\s*${escaped} \\{([^}]*)\\}`, "m"))?.[1] ?? "";
    const value = body.match(/z-index:\s*([^;]+);/)?.[1]?.trim() ?? "";
    const named = value.match(/^var\(--z-([a-z-]+)\)$/)?.[1];
    return named ? layers[named] : Number(value);
  }

  it("lê a escala no :root, de baixo para cima", () => {
    const order = ["dropdown", "topbar", "rail", "status", "float", "banner", "modal", "modal-studio", "modal-top", "tooltip"];
    const values = order.map((name) => layers[name]);
    expect(values.every((value) => Number.isFinite(value))).toBe(true);
    expect([...values].sort((a, b) => a - b)).toEqual(values);
  });

  it.each([
    [".platform-topbar", "topbar"],
    [".platform-sidebar", "rail"],
    [".floating-action", "float"],
    [".created-strip", "status"],
    [".cookie-consent", "banner"],
    [".community-drawer-backdrop", "modal"],
    [".lesson-modal-overlay", "modal-studio"],
  ])("%s está na camada %s", (selector, layer) => {
    expect(zOf(selector)).toBe(layers[layer]);
  });

  it("a barra lateral lida pelo teste de cima é a mesma da escala", () => {
    expect(sidebarZ).toBe(layers.rail);
  });

  // Avisos de andamento não cobrem o que a pessoa está usando: no celular o
  // cartão subido sentava em cima da caixa de mensagem do Advisor (68) e do
  // menu de categoria (67), e a faixa cobria o menu por 4s.
  it("a camada de status fica acima do menu lateral e abaixo do menu de categoria e do Advisor", () => {
    expect(layers.status).toBeGreaterThan(layers.rail);
    expect(layers.status).toBeLessThan(zOf(".course-category-menu"));
    expect(layers.status).toBeLessThan(zOf(".floating-action"));
  });

  it("o cartão de envio do vídeo fica na camada de status, abaixo de toda janela", () => {
    const source = readFileSync(join(root, "teacher", "lesson-upload-provider.tsx"), "utf8");
    const named = source.match(/<aside[^>]*className="[^"]*\bfixed\b[^"]*\bz-\[var\(--z-([a-z-]+)\)\]/)?.[1];
    expect(named).toBe("status");
    expect(layers.status).toBeLessThan(layers.modal);
    // No celular ele sobe acima da barra de baixo, como o aviso de cookies, e
    // o teto desconta a subida para o topo não sair da tela.
    expect(source).toContain("lesson-upload-card");
    const lifted = css.match(/body:has\(\.platform-mobile-nav\) \.lesson-upload-card \{([^}]*)\}/)?.[1] ?? "";
    expect(lifted).toContain("bottom: calc(60px + 1rem + env(safe-area-inset-bottom, 0px));");
    expect(lifted).toContain("max-height: calc(100svh - 60px - 2rem - env(safe-area-inset-bottom, 0px));");
  });
});
