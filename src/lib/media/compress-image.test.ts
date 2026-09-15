import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  compressImage,
  cropTo,
  ImageTooLargeError,
  MAX_SOURCE_IMAGE_BYTES,
} from "@/lib/media/compress-image";

// A capa do módulo é vertical 2:3 e comprimida no navegador: 10 MB entram,
// uns 300 KB saem. jsdom não tem createImageBitmap nem canvas de verdade, então
// os dois são dublados aqui; a conta do recorte é pura.

describe("cropTo", () => {
  it("quadrado 1000x1000 para 2:3 corta as laterais, no centro", () => {
    expect(cropTo(1000, 1000, 2 / 3)).toEqual({ x: 167, y: 0, w: 667, h: 1000 });
  });

  it("paisagem 1920x1080 corta as laterais", () => {
    expect(cropTo(1920, 1080, 2 / 3)).toEqual({ x: 600, y: 0, w: 720, h: 1080 });
  });

  it("retrato 1000x2000 corta em cima e embaixo", () => {
    expect(cropTo(1000, 2000, 2 / 3)).toEqual({ x: 0, y: 250, w: 1000, h: 1500 });
  });
});

describe("compressImage", () => {
  const drawImage = vi.fn();
  let toBlob: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    drawImage.mockReset();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 3000, height: 2000, close: vi.fn() })),
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      { drawImage } as unknown as CanvasRenderingContext2D,
    );
    toBlob = vi
      .spyOn(HTMLCanvasElement.prototype, "toBlob")
      .mockImplementation((callback: BlobCallback, type?: string) => {
        callback(new Blob(["comprimido"], { type }));
      });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("recorta 2:3 no centro em 640x960 e devolve WebP com qualidade 0.82", async () => {
    const out = await compressImage(new File(["original"], "capa.png", { type: "image/png" }));

    // 3000x2000 -> caixa de 1333x2000 centrada em x = 834.
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 834, 0, 1333, 2000, 0, 0, 640, 960);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/webp", 0.82);
    expect(out.type).toBe("image/webp");
    expect(out.name).toBe("capa.webp");
  });

  it("navegador sem WebP (o toBlob devolve outro tipo) cai para JPEG", async () => {
    toBlob.mockImplementation((callback: BlobCallback, type?: string) => {
      callback(new Blob(["comprimido"], { type: type === "image/webp" ? "image/png" : type }));
    });

    const out = await compressImage(new File(["original"], "capa.png", { type: "image/png" }));

    expect(toBlob).toHaveBeenLastCalledWith(expect.any(Function), "image/jpeg", 0.82);
    expect(out.type).toBe("image/jpeg");
    expect(out.name).toBe("capa.jpg");
  });

  it("recusa arquivo acima de 10 MB antes de comprimir", async () => {
    const big = new File(["x"], "enorme.jpg", { type: "image/jpeg" });
    Object.defineProperty(big, "size", { value: MAX_SOURCE_IMAGE_BYTES + 1 });

    await expect(compressImage(big)).rejects.toBeInstanceOf(ImageTooLargeError);
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it("se o navegador não abre a imagem (HEIC), devolve o original sem mexer", async () => {
    vi.mocked(createImageBitmap).mockRejectedValueOnce(new Error("formato não suportado"));
    const heic = new File(["original"], "foto.heic", { type: "image/heic" });

    await expect(compressImage(heic)).resolves.toBe(heic);
    expect(toBlob).not.toHaveBeenCalled();
  });
});
