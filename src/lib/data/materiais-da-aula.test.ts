import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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
  // Quando preenchido, o storage é o da supabase-js de verdade (só o fetch é falso).
  realStorage: null as SupabaseClient["storage"] | null,
}));

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowserClient: () => ({
    storage: mocks.realStorage ?? {
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
        // .update().eq().select("id"): a resposta diz quantas linhas mudaram.
        return { eq: (column: string, value: string) => ({ select: () => mocks.eq(column, value) }) };
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
  mocks.realStorage = null;
  for (const fn of [mocks.sign, mocks.upload, mocks.insert, mocks.update, mocks.eq]) fn.mockReset();
  mocks.sign.mockResolvedValue({ data: { signedUrl: "https://storage.test/signed" }, error: null });
  mocks.upload.mockResolvedValue({ error: null });
  mocks.insert.mockResolvedValue({ error: null });
  mocks.eq.mockResolvedValue({ data: [{ id: "changed" }], error: null });
});

describe("link assinado", () => {
  it("o link de baixar leva o nome original do arquivo, com a mesma 1 hora", async () => {
    const url = await getProtectedCourseAssetObjectUrl(material(), { download: true });

    expect(mocks.bucket).toBe("course-content");
    // O nome não vai pela opção da biblioteca (ela codifica duas vezes); vai
    // no fim do link, codificado uma vez só.
    expect(mocks.sign).toHaveBeenCalledExactlyOnceWith(material().storagePath, 3600);
    expect(url).toBe("https://storage.test/signed?download=Apostila%20final%20v3.pdf");
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

/**
 * A storage-js de verdade monta o link (só a resposta do servidor é falsa).
 * Ela codifica o nome duas vezes (URLSearchParams e depois encodeURI) e o
 * servidor do storage decodifica uma: "Introdução.pdf" chegava como
 * "Introdu%C3%A7%C3%A3o.pdf". Aqui o link é lido como o servidor lê (uma
 * decodificação, igual ao URL do navegador) e o nome tem que chegar idêntico.
 */
describe("nome do arquivo baixado, com a storage-js de verdade", () => {
  const signFetch = vi.fn(async (input: RequestInfo | URL) => {
    const signedPath = String(input).split("/object/sign/")[1];
    return new Response(JSON.stringify({ signedURL: `/object/sign/${signedPath}?token=t0k3n` }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  const realStorage = createClient("https://project.test", "public-test-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: signFetch },
  }).storage;

  it.each(["Apostila (1).pdf", "Introdução.pdf", "a,b&c#d+e%f.pdf"])("%s chega igual ao servidor", async (fileName) => {
    mocks.realStorage = realStorage;

    const url = await getProtectedCourseAssetObjectUrl(material({ fileName }), { download: true });

    expect(String(signFetch.mock.lastCall?.[0])).toContain("/storage/v1/object/sign/course-content/courses/course-1/");
    const query = new URL(url).searchParams;
    expect(query.get("download")).toBe(fileName);
    expect(query.get("token")).toBe("t0k3n");
  });

  it("o link de abrir não ganha nome nenhum", async () => {
    mocks.realStorage = realStorage;

    const url = await getProtectedCourseAssetObjectUrl(material({ fileName: "Introdução.pdf" }));

    expect(new URL(url).searchParams.has("download")).toBe(false);
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

  // A RLS filtra a linha sem dar erro (sessão sem segundo fator, curso de
  // outro dono): nenhuma linha mudou, e isso não pode virar "salvo".
  it("renomear que não mudou nenhuma linha é erro, não 'salvo'", async () => {
    mocks.eq.mockResolvedValueOnce({ data: [], error: null });

    await expect(renameCourseAsset("asset-1", "Guia")).rejects.toThrow("course-asset-not-updated");
  });

  it("reordenar com alguma linha que não mudou é erro, não 'salvo'", async () => {
    mocks.eq.mockResolvedValueOnce({ data: [{ id: "b" }], error: null }).mockResolvedValueOnce({ data: [], error: null });

    await expect(saveCourseAssetOrder([{ id: "b", position: 1 }, { id: "a", position: 0 }]))
      .rejects.toThrow("course-asset-not-updated");
  });
});

describe("tipo do arquivo no envio", () => {
  it.each([
    ["mapa.xmind", "", "application/vnd.xmind.workbook"],
    ["mapa.mm", "text/x-objective-c++", "application/x-freemind"],
    ["livro.epub", "application/epub+zip", "application/epub+zip"],
    ["notas.md", "", "application/octet-stream"],
    // Conteúdo ativo: aberto inline, o script rodaria no domínio do storage.
    ["logo.svg", "image/svg+xml", "application/octet-stream"],
    ["pagina.html", "text/html", "application/octet-stream"],
    ["feed.xml", "text/xml", "application/octet-stream"],
  ])("%s (navegador disse %j) sobe como %s", async (name, browserType, expected) => {
    const file = new File(["conteudo"], name, { type: browserType });

    await uploadCourseAsset({
      courseId: "course-1", ownerId: "teacher-1", kind: "lesson_material", file,
      isPreview: false, lessonId: "lesson-1",
    });

    expect(mocks.upload).toHaveBeenCalledWith(expect.any(String), expect.any(File), { contentType: expected, upsert: false });
    // A storage-js ignora `contentType` quando o corpo é um File e grava o tipo
    // do próprio File. O tipo seguro tem que estar no arquivo que sobe.
    const body = mocks.upload.mock.lastCall?.[1] as File;
    expect(body.type).toBe(expected);
    expect(body.name).toBe(name);
    expect(await body.text()).toBe("conteudo");
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ content_type: expected, file_name: name }));
  });
});

describe("arquivo antigo com conteúdo ativo", () => {
  it.each([
    ["logo.svg", "image/svg+xml"],
    ["pagina.html", "text/html"],
    ["feed.xml", "text/xml"],
  ])("o link de abrir de %s (%s) vem como anexo, com o mesmo pedido assinado", async (fileName, contentType) => {
    const url = await getProtectedCourseAssetObjectUrl(material({ fileName, contentType }));

    expect(mocks.sign).toHaveBeenCalledExactlyOnceWith(material().storagePath, 3600);
    expect(url).toBe(`https://storage.test/signed?download=${fileName}`);
  });

  it("PDF, imagem comum e vídeo continuam abrindo na tela", async () => {
    for (const contentType of ["application/pdf", "image/png", "video/mp4"]) {
      expect(await getProtectedCourseAssetObjectUrl(material({ contentType }))).toBe("https://storage.test/signed");
    }
  });

  it("recusa do storage (sem matrícula ou aula fechada) segue virando erro", async () => {
    mocks.sign.mockResolvedValue({ data: null, error: new Error("Object not found") });

    await expect(getProtectedCourseAssetObjectUrl(material({ contentType: "image/svg+xml" })))
      .rejects.toThrow("Object not found");
  });
});
