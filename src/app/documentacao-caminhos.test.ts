import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Documentação viva: todo caminho citado entre crases nestes documentos precisa
 * existir. Se um arquivo muda de lugar ou some, este teste quebra e obriga a
 * atualizar o documento no mesmo PR, em vez de o mapa apodrecer em silêncio.
 */
const RAIZ = process.cwd();
const DOCUMENTOS = ["README.md", "docs/ARQUITETURA.md", "docs/README.md"];
const CAMINHO = /`((?:src|supabase|scripts|\.github|docs)\/[^`\s]*)`/g;

describe("a documentação só cita caminhos que existem", () => {
  for (const documento of DOCUMENTOS) {
    it(documento, () => {
      const texto = readFileSync(join(RAIZ, documento), "utf8");
      const caminhos = [...texto.matchAll(CAMINHO)].map((m) => m[1]);

      // Um regex que não casa nada passaria verde sem conferir coisa alguma.
      expect(caminhos.length, `${documento} não cita nenhum caminho`).toBeGreaterThan(0);

      const faltando = caminhos.filter((c) => !existsSync(join(RAIZ, c)));
      expect(faltando, `${documento} cita caminhos que não existem`).toEqual([]);
    });
  }
});
