import { beforeEach, describe, expect, it, vi } from "vitest";

import { supabaseUploadLimitBytes } from "@/domain/course-asset";
import {
  uploadCourseAsset,
  type UploadCourseAssetProgress,
} from "@/lib/data/course-assets";

const mocks = vi.hoisted(() => ({
  getPublicUrl: vi.fn(),
  insert: vi.fn(),
  remove: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowserClient: () => ({
    storage: {
      from: () => ({
        upload: mocks.upload,
        getPublicUrl: mocks.getPublicUrl,
        remove: mocks.remove,
      }),
    },
    from: () => ({ insert: mocks.insert }),
  }),
}));

function imageFile(size = 1024) {
  const file = new File(["x"], "capa.png", { type: "image/png" });
  // `size` é getter do Blob; sobrescrever evita alocar dezenas de MB no teste.
  Object.defineProperty(file, "size", { value: size });
  return file;
}

function input(
  file: File,
  onProgress?: (progress: UploadCourseAssetProgress) => void,
) {
  return {
    courseId: "course-1",
    ownerId: "owner-1",
    kind: "module_cover" as const,
    file,
    isPreview: false,
    moduleId: "module-1",
    onProgress,
  };
}

describe("uploadCourseAsset — progresso honesto", () => {
  beforeEach(() => {
    mocks.upload.mockReset();
    mocks.upload.mockResolvedValue({ error: null });
    mocks.insert.mockReset();
    mocks.insert.mockResolvedValue({ error: null });
    mocks.remove.mockReset();
    mocks.remove.mockResolvedValue({ error: null });
    mocks.getPublicUrl.mockReset();
    mocks.getPublicUrl.mockReturnValue({
      data: { publicUrl: "https://project.supabase.co/storage/v1/object/public/public-media/capa.png" },
    });
  });

  // supabase-js upload() não informa progresso. Emitir 0% e ficar parado ali
  // o envio inteiro se lia como "travou" — e a reação natural era fechar a aba.
  it("não inventa porcentagem enquanto o Storage envia: percent é null", async () => {
    const events: UploadCourseAssetProgress[] = [];

    await uploadCourseAsset(input(imageFile(), (progress) => events.push(progress)));

    const running = events.filter((event) => event.state === "running");
    expect(running.length).toBeGreaterThan(0);
    for (const event of running) {
      expect(event.percent).toBeNull();
    }
  });

  it("só emite 'success' depois de a linha existir no banco", async () => {
    const events: UploadCourseAssetProgress[] = [];
    mocks.insert.mockResolvedValueOnce({ error: new Error("insert failed") });

    await expect(
      uploadCourseAsset(input(imageFile(), (progress) => events.push(progress))),
    ).rejects.toThrow("insert failed");

    // Antes, o 100% saía entre o upload dos bytes e o insert: a tela mostrava
    // "Upload complete 100%" em cima da caixa vermelha de falha.
    expect(events.some((event) => event.state === "success")).toBe(false);
  });

  it("emite 'success' com 100% quando tudo gravou", async () => {
    const events: UploadCourseAssetProgress[] = [];

    await uploadCourseAsset(input(imageFile(), (progress) => events.push(progress)));

    const last = events.at(-1);
    expect(last?.state).toBe("success");
    expect(last?.percent).toBe(100);
    expect(mocks.insert).toHaveBeenCalledTimes(1);
  });

  // O teto do plano (50 MB) vence o do bucket (500 MB). Um PNG de 80 MB passava
  // na validação de tipo e caía num 413 — ou pior, na mensagem genérica.
  it("recusa acima do teto efetivo com a mensagem do limite, antes de tocar o Storage", async () => {
    await expect(
      uploadCourseAsset(input(imageFile(supabaseUploadLimitBytes + 1))),
    ).rejects.toThrow(/exceeds the current upload limit/);

    expect(mocks.upload).not.toHaveBeenCalled();
  });
});
