import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { getCourseSlugs } from "@/lib/data/catalog";

/**
 * `generateStaticParams` marca a rota como estática (SSG) no build. Com lista
 * vazia, o build não gera nenhuma página e não descobre que a rota lê a sessão;
 * em produção, a primeira visita tenta gerar a página estática, esbarra no
 * cookie e a Vercel serve /500. Foi o que derrubou as abas da sala, a pergunta
 * da comunidade e /learn/community/<curso> de 02/09 a 10/09.
 *
 * Só as páginas abaixo exportam a função, porque a lista delas vem do catálogo
 * e não é vazia: ao gerar a primeira página, o build esbarra no cookie e marca
 * a rota como dinâmica (ƒ na tabela de rotas do build).
 */
const CATALOG_PAGES = ["courses/[slug]/page.tsx", "learn/courses/[slug]/page.tsx"];
const APP_DIR = join(process.cwd(), "src", "app");

function collectPageFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return collectPageFiles(full);
    }
    return entry === "page.tsx" ? [full] : [];
  });
}

describe("rotas com generateStaticParams", () => {
  const withStaticParams = collectPageFiles(APP_DIR)
    .filter((file) => readFileSync(file, "utf8").includes("generateStaticParams"))
    .map((file) => relative(APP_DIR, file).split(sep).join("/"));

  it("só as páginas do catálogo exportam a função", () => {
    expect(withStaticParams.filter((page) => !CATALOG_PAGES.includes(page))).toEqual([]);
  });

  it("o catálogo que alimenta essas páginas não está vazio", () => {
    expect(getCourseSlugs().length).toBeGreaterThan(0);
  });
});
