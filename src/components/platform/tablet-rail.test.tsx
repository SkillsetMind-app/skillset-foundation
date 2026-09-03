import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * No tablet a navegação era a de CELULAR: numa tela de 1000px de largura, com
 * espaço de sobra, a barra lateral sumia e entrava a barra de baixo. O rail de
 * 64px já existia e só era alcançável acima de 1024px.
 *
 * Varredura no CSS porque o jsdom não avalia media query nenhuma: `matchMedia`
 * é um esqueleto que sempre responde `false`, e nada aqui tem layout. O que dá
 * para provar é a REGRA — em que faixa cada desenho vale.
 */

const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");

/**
 * TODOS os blocos `@media (...) { ... }` daquela faixa, colados. A mesma faixa
 * aparece em vários pontos do arquivo (o banner de cookies e a navegação são
 * dois deles); a pergunta que interessa é o que a faixa faz no total.
 */
function mediaBlocks(query: string): string {
  const marker = `@media ${query} {`;
  const found: string[] = [];
  let cursor = css.indexOf(marker);

  while (cursor > -1) {
    let depth = 0;

    for (let index = css.indexOf("{", cursor); index < css.length; index += 1) {
      if (css[index] === "{") {
        depth += 1;
      } else if (css[index] === "}") {
        depth -= 1;

        if (depth === 0) {
          found.push(css.slice(cursor, index + 1));
          cursor = css.indexOf(marker, index);
          break;
        }
      }
    }
  }

  expect(found.length, `bloco não encontrado: @media ${query}`).toBeGreaterThan(0);

  return found.join("\n");
}

describe("tablet (768–1023px) usa o rail, não a barra de baixo", () => {
  it("a barra de baixo e o sumiço da lateral valem só abaixo de 768px", () => {
    const phone = mediaBlocks("(max-width: 767.98px)");

    expect(phone).toContain(".platform-mobile-nav");
    expect(phone).toContain("display: flex");
    expect(phone).toMatch(/\.platform-sidebar \{\s*display: none/);

    // E não sobrou nenhum bloco de 1023px acendendo a barra de baixo ou
    // apagando a lateral — que era exatamente o bug.
    const tabletAndBelow = mediaBlocks("(max-width: 1023px)");
    expect(tabletAndBelow).not.toContain(".platform-mobile-nav");
    expect(tabletAndBelow).not.toContain(".platform-sidebar {");
  });

  it("de 768 a 1023px a coluna da lateral é o rail de 64px, e o botão de recolher some", () => {
    const tablet = mediaBlocks("(min-width: 768px) and (max-width: 1023px)");

    expect(tablet).toContain("--platform-sidebar-width: 64px");
    expect(tablet).toMatch(
      /\.platform-sidebar \.platform-sidebar-toggle \{\s*display: none/,
    );
    // Os rótulos não podem vazar dentro de 64px enquanto a classe não chega.
    expect(tablet).toContain(".platform-sidebar-label");
  });

  it("o banner de cookies só sobe onde a barra de baixo existe de fato", () => {
    // Ele sobe 60px para não cobrir a barra. No tablet não há barra, e o
    // banner ficaria flutuando com um buraco embaixo.
    const phone = mediaBlocks("(max-width: 767.98px)");
    expect(phone).toContain("body:has(.platform-mobile-nav) .cookie-consent");
  });

  it("a playlist embaixo do vídeo vai a duas colunas de 768 a 1180px", () => {
    const strip = mediaBlocks("(min-width: 768px) and (max-width: 1180px)");

    expect(strip).toContain(".member-playlist__lessons");
    expect(strip).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");

    // Abaixo de 1180 a lateral inteira já era uma coluna; a regra nova precisa
    // vir DEPOIS dela para valer (mesma especificidade, ganha a última).
    expect(css.indexOf("@media (min-width: 768px) and (max-width: 1180px)")).toBeGreaterThan(
      css.indexOf("@media (max-width: 1180px)"),
    );
  });
});
