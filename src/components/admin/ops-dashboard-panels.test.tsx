import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Os oito paineis de /ops abriam com uma manchete de 30px em serifa mais um
// paragrafo de tres linhas: o operador rolava manchete antes de ver a fila
// (reanalise Ops 4). O titulo virou 16px sem serifa, como o do Audit log.

const adminDir = join(process.cwd(), "src/components/admin");

describe("paineis de /ops", () => {
  it("nenhum painel abre com manchete em serifa (display-title)", () => {
    const panels = readdirSync(adminDir).filter(
      (name) => name.endsWith(".tsx") && !name.endsWith(".test.tsx"),
    );
    expect(panels.length).toBeGreaterThan(5);

    const offenders = panels.filter((name) =>
      readFileSync(join(adminDir, name), "utf8").includes("display-title"),
    );
    expect(offenders).toEqual([]);
  });
});

describe("links internos abrem na mesma aba", () => {
  it("a pagina do produto no hub de gerenciamento nao abre em aba nova", () => {
    const hub = readFileSync(
      join(process.cwd(), "src/components/teacher/course-manage-hub.tsx"),
      "utf8",
    );
    const productLink = /<Link\s+href=\{productPagePath\}[^>]*>/.exec(hub)?.[0];

    expect(productLink).toBeDefined();
    expect(productLink).not.toContain("_blank");
  });

  // Excecao: termos legais abertos de dentro de um formulario (onboarding).
  // Navegar na mesma aba perderia o que a pessoa ja preencheu.
  it("nenhum <Link> para rota interna (href literal com /) pede target _blank", () => {
    const files = readdirSync(join(process.cwd(), "src/components"), {
      recursive: true,
      withFileTypes: true,
    })
      .filter((e) => e.isFile() && e.name.endsWith(".tsx") && !e.name.endsWith(".test.tsx"))
      .map((e) => join(e.parentPath, e.name));
    expect(files.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/<Link\b[^>]*>/g)) {
        const tag = match[0];
        if (/href="\/(?!legal\/)[^"]*"/.test(tag) && tag.includes('target="_blank"')) {
          violations.push(`${file}: ${tag.slice(0, 80)}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
