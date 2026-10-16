import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  compareCourseAssets,
  courseAssetAcceptTypes,
  courseContentMimeTypes,
  getCourseAssetContentType,
  getCourseAssetTitle,
  isAllowedCourseAssetFile,
  supabaseUploadLimitBytes,
  type CourseAsset,
} from "@/domain/course-asset";

function file(name: string, type: string, size = 1024) {
  const created = new File(["x"], name, { type });
  // `size` é getter do Blob; sobrescrever evita alocar dezenas de MB no teste.
  Object.defineProperty(created, "size", { value: size });
  return created;
}

describe("e-book e mapa mental como material da aula", () => {
  it.each([
    ["livro.epub", "application/epub+zip"],
    ["livro.EPUB", ""],
    ["mapa.xmind", ""],
    ["mapa.xmind", "application/octet-stream"],
    ["mapa.mm", ""],
  ])("aceita %s (tipo do navegador %j)", (name, type) => {
    expect(isAllowedCourseAssetFile(file(name, type), "lesson_material")).toBe(true);
  });

  it("o seletor de arquivo oferece as três extensões", () => {
    const accept = courseAssetAcceptTypes.lesson_material.split(",");
    expect(accept).toEqual(expect.arrayContaining([".epub", "application/epub+zip", ".xmind", ".mm"]));
  });

  it("o teto de 50 MB não mudou", () => {
    expect(supabaseUploadLimitBytes).toBe(50 * 1024 * 1024);
    expect(isAllowedCourseAssetFile(file("livro.epub", "application/epub+zip", supabaseUploadLimitBytes), "lesson_material")).toBe(true);
    expect(isAllowedCourseAssetFile(file("livro.epub", "application/epub+zip", supabaseUploadLimitBytes + 1), "lesson_material")).toBe(false);
  });

  it("capa continua só imagem, mesmo com extensão de material", () => {
    expect(isAllowedCourseAssetFile(file("mapa.xmind", ""), "course_cover")).toBe(false);
  });

  it("a extensão decide o tipo gravado dos três; os outros seguem o navegador", () => {
    expect(getCourseAssetContentType(file("mapa.xmind", ""))).toBe("application/vnd.xmind.workbook");
    expect(getCourseAssetContentType(file("mapa.mm", "text/x-objective-c++"))).toBe("application/x-freemind");
    expect(getCourseAssetContentType(file("livro.epub", ""))).toBe("application/epub+zip");
    expect(getCourseAssetContentType(file("aula.pdf", "application/pdf"))).toBe("application/pdf");
    expect(getCourseAssetContentType(file("sem-tipo.bin", ""))).toBe("application/octet-stream");
  });
});

describe("nome e ordem do arquivo", () => {
  const asset = (id: string, fileName: string, title: string | null, position: number | null) =>
    ({ id, fileName, title, position }) as CourseAsset;

  it("o aluno lê o nome dado pelo professor; sem ele, o nome do arquivo", () => {
    expect(getCourseAssetTitle(asset("a", "slides-v3.pdf", "Slides", 0))).toBe("Slides");
    expect(getCourseAssetTitle(asset("a", "slides-v3.pdf", "   ", 0))).toBe("slides-v3.pdf");
    expect(getCourseAssetTitle(asset("a", "slides-v3.pdf", null, 0))).toBe("slides-v3.pdf");
  });

  it("posição primeiro, depois o nome; sem posição vai para o fim", () => {
    const sorted = [
      asset("late-b", "b.pdf", null, null),
      asset("two", "z.pdf", "Zeta", 1),
      asset("late-a", "a.pdf", null, null),
      asset("one-z", "y.pdf", "Zulu", 0),
      asset("one-a", "x.pdf", "Alfa", 0),
    ].sort(compareCourseAssets);

    expect(sorted.map((item) => item.id)).toEqual(["one-a", "one-z", "two", "late-a", "late-b"]);
  });
});

/**
 * Um SVG (ou HTML, XML) aberto pelo "Open file" rodava script no domínio do
 * storage. Fora da lista segura, o arquivo sobe como application/octet-stream:
 * o navegador baixa, não abre.
 */
describe("conteúdo ativo nunca abre no domínio do storage", () => {
  it.each([
    ["logo.svg", "image/svg+xml"],
    ["logo.svg", ""],
    ["pagina.html", "text/html"],
    ["pagina.xhtml", "application/xhtml+xml"],
    ["feed.xml", "text/xml"],
    ["feed.xml", "application/xml"],
    ["estilo.xsl", "text/xsl"],
  ])("%s (navegador disse %j) sobe como download", (name, type) => {
    expect(getCourseAssetContentType(file(name, type))).toBe("application/octet-stream");
  });

  it.each([
    ["foto.png", "image/png"],
    ["aula.mp4", "video/mp4"],
    ["aula.mov", "video/quicktime"],
    ["audio.mp3", "audio/mpeg"],
    ["notas.txt", "text/plain"],
    ["notas.md", "text/markdown"],
    ["planilha.csv", "text/csv"],
    ["texto.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ])("%s mantém o tipo do navegador (%s)", (name, type) => {
    expect(getCourseAssetContentType(file(name, type))).toBe(type);
  });

  it("a lista do código é a mesma que a migration grava no bucket course-content", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/20261008020000_course_content_sem_conteudo_ativo.sql"),
      "utf8",
    );
    const array = /allowed_mime_types\s*=\s*array\[([^\]]*)\]/.exec(sql)?.[1] ?? "";
    const fromSql = [...array.matchAll(/'([^']+)'/g)].map((match) => match[1]);

    expect([...fromSql].sort()).toEqual([...courseContentMimeTypes].sort());
    expect(courseContentMimeTypes).not.toContain("image/svg+xml");
    expect(courseContentMimeTypes).not.toContain("image/*");
    expect(courseContentMimeTypes).not.toContain("text/*");
  });
});
