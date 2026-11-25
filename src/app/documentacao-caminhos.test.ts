import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Living documentation: every path cited between backticks in these documents must
 * exist. If a file moves or goes away, this test breaks and forces the document to
 * be updated in the same PR, instead of the map rotting in silence.
 */
const RAIZ = process.cwd();
const DOCUMENTOS = [
  "README.md",
  "docs/ARCHITECTURE.md",
  "docs/README.md",
  "docs/ONBOARDING.md",
];
const CAMINHO = /`((?:src|supabase|scripts|\.github|docs)\/[^`\s]*)`/g;

describe("the documentation only cites paths that exist", () => {
  for (const documento of DOCUMENTOS) {
    it(documento, () => {
      const texto = readFileSync(join(RAIZ, documento), "utf8");
      const caminhos = [...texto.matchAll(CAMINHO)].map((m) => m[1]);

      // A regex that matches nothing would pass green without checking anything.
      expect(caminhos.length, `${documento} cites no path`).toBeGreaterThan(0);

      const faltando = caminhos.filter((c) => !existsSync(join(RAIZ, c)));
      expect(faltando, `${documento} cites paths that do not exist`).toEqual([]);
    });
  }
});
