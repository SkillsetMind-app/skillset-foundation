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

  it.each(overlays)("%s fica acima da barra lateral (z %i)", (_, z) => {
    expect(z).toBeGreaterThan(sidebarZ);
  });
});
