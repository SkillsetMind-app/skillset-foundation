import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Toda página de /learn é montada dentro do `PlatformShell`, e é ELE quem
 * emite o `<h1>`. Logo, o primeiro cabeçalho do componente que a página
 * renderiza é o nível 2 — não o 3.
 *
 * Nove componentes de /learn abriam em `h3` e três em `h4`, direto sob o h1:
 * a área do aluno inteira pulava um degrau, e quem navega por cabeçalho
 * (leitor de tela, atalho de navegação) caía do título da página direto numa
 * subseção, sem o nível intermediário que diz "esta é a seção principal".
 *
 * Esta prova é de CÓDIGO-FONTE, de propósito. A tentativa óbvia — renderizar
 * a página e ler a árvore — passa sem enxergar nada: os hubs de /learn são
 * client components atrás de `ProtectedSurface`, e no harness de teste só o
 * h1 do shell chega ao DOM. Um teste assim ficaria verde com o defeito de
 * volta, que é pior que não ter teste.
 */

const LEARN_PAGES_DIR = join(process.cwd(), "src", "app", "learn");
const LEARN_COMPONENTS_DIR = join(process.cwd(), "src", "components", "learn");

function collectPageFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return collectPageFiles(full);
    }
    return entry === "page.tsx" ? [full] : [];
  });
}

/** Componentes de `@/components/learn/...` importados por uma página. */
function importedLearnComponents(pageSource: string): string[] {
  return Array.from(
    pageSource.matchAll(/from\s+"@\/components\/learn\/([\w-]+)"/g),
  ).map((match) => match[1]);
}

function firstHeadingLevel(componentSource: string): number | null {
  const match = componentSource.match(/<h([1-6])[\s>]/);
  return match ? Number(match[1]) : null;
}

describe("níveis de cabeçalho da área do aluno", () => {
  const pages = collectPageFiles(LEARN_PAGES_DIR);

  it("encontra as páginas de /learn", () => {
    expect(pages.length).toBeGreaterThan(5);
  });

  it("nenhum componente de topo de /learn abre abaixo do h2", () => {
    const offenders: string[] = [];

    for (const page of pages) {
      const pageSource = readFileSync(page, "utf8");

      // Só páginas que passam pelo shell: são as que já têm um h1 acima.
      if (!pageSource.includes("PlatformShell")) {
        continue;
      }

      for (const componentName of importedLearnComponents(pageSource)) {
        const componentPath = join(
          LEARN_COMPONENTS_DIR,
          `${componentName}.tsx`,
        );
        let source: string;
        try {
          source = readFileSync(componentPath, "utf8");
        } catch {
          continue;
        }

        const level = firstHeadingLevel(source);
        if (level !== null && level > 2) {
          offenders.push(`${componentName}.tsx abre em h${level}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
