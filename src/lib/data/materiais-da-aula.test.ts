import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CourseAsset } from "@/domain/course-asset";
import {
  fetchCourseAssets,
  getProtectedCourseAssetObjectUrl,
  renameCourseAsset,
  saveCourseAssetOrder,
  uploadCourseAsset,
} from "@/lib/data/course-assets";

/**
 * Materiais da aula no cliente do Supabase: o link de baixar leva o nome do
 * arquivo, a lista sai na ordem do professor, renomear e reordenar gravam só o
 * necessário, e .xmind/.epub/.mm sobem com o tipo certo.
 */
const mocks = vi.hoisted(() => ({
  sign: vi.fn(),
  upload: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  rows: [] as Record<string, unknown>[],
  bucket: "",
}));

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowserClient: () => ({
    storage: {
      from: (bucket: string) => {
        mocks.bucket = bucket;
        return {
          createSignedUrl: mocks.sign,
          upload: mocks.upload,
          getPublicUrl: () => ({ data: { publicUrl: "" } }),
          remove: vi.fn(async () => ({ error: null })),
        };
      },
    },
    from: () => ({
      insert: mocks.insert,
      update: (patch: unknown) => {
        mocks.update(patch);
        return { eq: (column: string, value: string) => mocks.eq(column, value) };
      },
      select: () => ({ eq: async () => ({ data: mocks.rows, error: null }) }),
    }),
  }),
}));

const material = (overrides: Partial<CourseAsset> = {}): CourseAsset => ({
  id: "asset-1", courseId: "course-1", ownerId: "teacher-1", kind: "lesson_material",
  fileName: "Apostila final v3.pdf", contentType: "application/pdf", size: 1024,
  storagePath: "courses/course-1/assets/teacher-1/asset-1/apostila-final-v3.pdf",
  isPreview: false, lessonId: "lesson-1", ...overrides,
});

function row(id: string, fileName: string, title: string | null, position: number | null) {
  return {
    id, course_id: "course-1", owner_id: "teacher-1", kind: "lesson_material", file_name: fileName,
    content_type: "application/pdf", size: 1, storage_path: `p/${id}`, download_url: null,
    bunny_video_id: null, is_preview: false, lesson_id: "lesson-1", module_id: null,
    title, position, created_at: null, updated_at: null,
  };
}

beforeEach(() => {
  for (const fn of [mocks.sign, mocks.upload, mocks.insert, mocks.update, mocks.eq]) fn.mockReset();
  mocks.sign.mockResolvedValue({ data: { signedUrl: "https://storage.test/signed" }, error: null });
  mocks.upload.mockResolvedValue({ error: null });
  mocks.insert.mockResolvedValue({ error: null });
  mocks.eq.mockResolvedValue({ error: null });
});

describe("link assinado", () => {
  it("o link de baixar leva o nome original do arquivo, com a mesma 1 hora", async () => {
    await getProtectedCourseAssetObjectUrl(material(), { download: true });

    expect(mocks.bucket).toBe("course-content");
    expect(mocks.sign).toHaveBeenCalledExactlyOnceWith(
      material().storagePath, 3600, { download: "Apostila final v3.pdf" },
    );
  });

  it("o link de abrir continua sem a opção de baixar", async () => {
    await getProtectedCourseAssetObjectUrl(material());

    expect(mocks.sign).toHaveBeenCalledExactlyOnceWith(material().storagePath, 3600);
  });

  it("recusa do storage (sem matrícula ou aula fechada) vira erro, não link", async () => {
    mocks.sign.mockResolvedValue({ data: null, error: new Error("Object not found") });

    await expect(getProtectedCourseAssetObjectUrl(material(), { download: true })).rejects.toThrow("Object not found");
  });
});

describe("ordem e nome", () => {
  it("lê pela posição, depois pelo nome que aparece; arquivo sem posição vai para o fim", async () => {
    mocks.rows = [
      row("new-b", "b.pdf", null, null),
      row("second", "zz.pdf", "Workbook", 1),
      row("new-a", "a.pdf", null, null),
      row("first", "yy.pdf", "Slides", 0),
    ];

    const assets = await fetchCourseAssets("course-1");

    expect(assets.map((asset) => asset.id)).toEqual(["first", "second", "new-a", "new-b"]);
    expect(assets[0]).toMatchObject({ title: "Slides", position: 0 });
  });

  it("lê também antes da migration (sem as colunas novas)", async () => {
    const old: Record<string, unknown> = row("old", "notes.pdf", null, null);
    delete old.title;
    delete old.position;
    mocks.rows = [old];

    const [asset] = await fetchCourseAssets("course-1");

    expect(asset).toMatchObject({ title: null, position: null, fileName: "notes.pdf" });
  });

  it("renomear apara o texto; vazio volta ao nome do arquivo", async () => {
    await renameCourseAsset("asset-1", "  Guia de estudo  ");
    await renameCourseAsset("asset-1", "   ");

    expect(mocks.update.mock.calls).toEqual([[{ title: "Guia de estudo" }], [{ title: null }]]);
    expect(mocks.eq).toHaveBeenCalledWith("id", "asset-1");
  });

  it("reordenar grava só as linhas cuja posição mudou", async () => {
    await saveCourseAssetOrder([
      { id: "b", position: 1 },
      { id: "a", position: 0 },
      { id: "c", position: 2 },
    ]);

    expect(mocks.update.mock.calls).toEqual([[{ position: 0 }], [{ position: 1 }]]);
    expect(mocks.eq.mock.calls).toEqual([["id", "b"], ["id", "a"]]);
  });

  it("falha ao gravar a ordem chega a quem chamou", async () => {
    mocks.eq.mockResolvedValueOnce({ error: new Error("denied") });

    await expect(saveCourseAssetOrder([{ id: "b", position: 1 }, { id: "a", position: 0 }])).rejects.toThrow("denied");
  });
});

describe("tipo do arquivo no envio", () => {
  it.each([
    ["mapa.xmind", "", "application/vnd.xmind.workbook"],
    ["mapa.mm", "text/x-objective-c++", "application/x-freemind"],
    ["livro.epub", "application/epub+zip", "application/epub+zip"],
    ["notas.md", "", "application/octet-stream"],
  ])("%s (navegador disse %j) sobe como %s", async (name, browserType, expected) => {
    const file = new File(["x"], name, { type: browserType });

    await uploadCourseAsset({
      courseId: "course-1", ownerId: "teacher-1", kind: "lesson_material", file,
      isPreview: false, lessonId: "lesson-1",
    });

    expect(mocks.upload).toHaveBeenCalledWith(expect.any(String), file, { contentType: expected, upsert: false });
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ content_type: expected, file_name: name }));
  });
});
