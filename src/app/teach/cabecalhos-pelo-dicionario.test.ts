import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// O que a pessoa sofria: com a interface em espanhol, Relatorios abria com
// "Teacher Studio / Reports." e o paragrafo inteiro em ingles — o cabecalho era
// texto fixo na pagina, fora do dicionario (QA visual em producao, 08/09).
// Vendas e Eventos tinham o mesmo cabecalho fixo.

const pages = ["reports", "sales", "events"] as const;
const en = JSON.parse(readFileSync("src/data/i18n/en.json", "utf8"));
const es = JSON.parse(readFileSync("src/data/i18n/es.json", "utf8"));

describe("cabecalhos das paginas do estudio", () => {
  it.each(pages)("a pagina %s nao carrega texto fixo no cabecalho", (page) => {
    const source = readFileSync(`src/app/teach/${page}/page.tsx`, "utf8");

    expect(source).not.toMatch(/\b(eyebrow|title|description)="/);
    expect(source).toContain("getServerTranslation");
  });

  it.each(pages)("o cabecalho de %s existe nos dois idiomas e muda de idioma", (page) => {
    const key = `${page}Page`;

    for (const field of ["eyebrow", "title", "description"]) {
      expect(en.teach[key][field], `en teach.${key}.${field}`).toBeTruthy();
      expect(es.teach[key][field], `es teach.${key}.${field}`).toBeTruthy();
    }
    expect(es.teach[key].title).not.toBe(en.teach[key].title);
    expect(es.teach[key].description).not.toBe(en.teach[key].description);
  });
});
