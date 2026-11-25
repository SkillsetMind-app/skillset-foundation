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
  // `size` is a getter on Blob; overriding it avoids allocating tens of MB in the test.
  Object.defineProperty(created, "size", { value: size });
  return created;
}

describe("e-book and mind map as lesson material", () => {
  it.each([
    ["livro.epub", "application/epub+zip"],
    ["livro.EPUB", ""],
    ["mapa.xmind", ""],
    ["mapa.xmind", "application/octet-stream"],
    ["mapa.mm", ""],
  ])("accepts %s (browser type %j)", (name, type) => {
    expect(isAllowedCourseAssetFile(file(name, type), "lesson_material")).toBe(true);
  });

  it("the file picker offers the three extensions", () => {
    const accept = courseAssetAcceptTypes.lesson_material.split(",");
    expect(accept).toEqual(expect.arrayContaining([".epub", "application/epub+zip", ".xmind", ".mm"]));
  });

  it("the 50 MB cap did not change", () => {
    expect(supabaseUploadLimitBytes).toBe(50 * 1024 * 1024);
    expect(isAllowedCourseAssetFile(file("livro.epub", "application/epub+zip", supabaseUploadLimitBytes), "lesson_material")).toBe(true);
    expect(isAllowedCourseAssetFile(file("livro.epub", "application/epub+zip", supabaseUploadLimitBytes + 1), "lesson_material")).toBe(false);
  });

  it("the cover is still image only, even with a material extension", () => {
    expect(isAllowedCourseAssetFile(file("mapa.xmind", ""), "course_cover")).toBe(false);
  });

  it("the extension decides the stored type of the three; the others follow the browser", () => {
    expect(getCourseAssetContentType(file("mapa.xmind", ""))).toBe("application/vnd.xmind.workbook");
    expect(getCourseAssetContentType(file("mapa.mm", "text/x-objective-c++"))).toBe("application/x-freemind");
    expect(getCourseAssetContentType(file("livro.epub", ""))).toBe("application/epub+zip");
    expect(getCourseAssetContentType(file("aula.pdf", "application/pdf"))).toBe("application/pdf");
    expect(getCourseAssetContentType(file("sem-tipo.bin", ""))).toBe("application/octet-stream");
  });
});

describe("file name and order", () => {
  const asset = (id: string, fileName: string, title: string | null, position: number | null) =>
    ({ id, fileName, title, position }) as CourseAsset;

  it("the learner reads the name given by the teacher; without it, the file name", () => {
    expect(getCourseAssetTitle(asset("a", "slides-v3.pdf", "Slides", 0))).toBe("Slides");
    expect(getCourseAssetTitle(asset("a", "slides-v3.pdf", "   ", 0))).toBe("slides-v3.pdf");
    expect(getCourseAssetTitle(asset("a", "slides-v3.pdf", null, 0))).toBe("slides-v3.pdf");
  });

  it("position first, then the name; with no position it goes to the end", () => {
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
 * An SVG (or HTML, XML) opened by "Open file" ran script on the
 * storage domain. Outside the safe list, the file is uploaded as application/octet-stream:
 * the browser downloads it, it does not open it.
 */
describe("active content never opens on the storage domain", () => {
  it.each([
    ["logo.svg", "image/svg+xml"],
    ["logo.svg", ""],
    ["pagina.html", "text/html"],
    ["pagina.xhtml", "application/xhtml+xml"],
    ["feed.xml", "text/xml"],
    ["feed.xml", "application/xml"],
    ["estilo.xsl", "text/xsl"],
  ])("%s (browser said %j) is uploaded as a download", (name, type) => {
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
  ])("%s keeps the browser type (%s)", (name, type) => {
    expect(getCourseAssetContentType(file(name, type))).toBe(type);
  });

  it("the list in the code is the same one the migration writes to the course-content bucket", () => {
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
