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
  const fillRect = vi.fn();
  const context = {
    drawImage,
    fillRect,
    fillStyle: "",
    imageSmoothingEnabled: false,
    imageSmoothingQuality: "low",
  };
  let toBlob: ReturnType<typeof vi.spyOn>;

  function bitmapOf(width: number, height: number) {
    return { width, height, close: vi.fn() } as unknown as ImageBitmap;
  }

  beforeEach(() => {
    drawImage.mockReset();
    fillRect.mockReset();
    context.fillStyle = "";
    context.imageSmoothingEnabled = false;
    context.imageSmoothingQuality = "low";
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => bitmapOf(3000, 2000)),
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      context as unknown as CanvasRenderingContext2D,
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
    // WebP guarda a transparência: nada de fundo branco aqui.
    expect(fillRect).not.toHaveBeenCalled();
  });

  it("liga a suavização alta antes de desenhar (a redução fica sem serrilhado)", async () => {
    let qualityAtDraw = "";
    drawImage.mockImplementation(() => {
      qualityAtDraw = context.imageSmoothingQuality;
    });

    await compressImage(new File(["original"], "capa.png", { type: "image/png" }));

    expect(qualityAtDraw).toBe("high");
  });

  it("foto pequena não é ampliada: 500x600 sai 400x600, ainda 2:3", async () => {
    vi.mocked(createImageBitmap).mockResolvedValueOnce(bitmapOf(500, 600));
    const sizes: Array<[number, number]> = [];
    toBlob.mockImplementation(function (this: HTMLCanvasElement, callback: BlobCallback, type?: string) {
      sizes.push([this.width, this.height]);
      callback(new Blob(["comprimido"], { type }));
    });

    await compressImage(new File(["original"], "capa.png", { type: "image/png" }));

    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 50, 0, 400, 600, 0, 0, 400, 600);
    expect(sizes).toEqual([[400, 600]]);
  });

  it("já 2:3, tipo comum e a compressão não diminuiu: fica o original", async () => {
    vi.mocked(createImageBitmap).mockResolvedValue(bitmapOf(640, 960));
    // "comprimido" (10 bytes) não é menor que "original" (8 bytes).
    const png = new File(["original"], "capa.png", { type: "image/png" });

    await expect(compressImage(png)).resolves.toBe(png);

    // HEIC não fica como está: nem todo navegador mostra.
    const heic = new File(["original"], "capa.heic", { type: "image/heic" });
    expect((await compressImage(heic)).type).toBe("image/webp");
  });

  it("GIF (pode ser animado) sobe o original, mas o teto de 10 MB continua", async () => {
    const gif = new File(["GIF89a"], "capa.gif", { type: "image/gif" });

    await expect(compressImage(gif)).resolves.toBe(gif);
    expect(createImageBitmap).not.toHaveBeenCalled();

    const bigGif = new File(["x"], "enorme.gif", { type: "image/gif" });
    Object.defineProperty(bigGif, "size", { value: MAX_SOURCE_IMAGE_BYTES + 1 });
    await expect(compressImage(bigGif)).rejects.toBeInstanceOf(ImageTooLargeError);
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

  it("no JPEG pinta o fundo de branco antes de desenhar (PNG transparente não fica preto)", async () => {
    toBlob.mockImplementation((callback: BlobCallback, type?: string) => {
      callback(new Blob(["comprimido"], { type: type === "image/webp" ? "image/png" : type }));
    });
    let colorAtFill = "";
    fillRect.mockImplementation(() => {
      colorAtFill = context.fillStyle;
    });

    await compressImage(new File(["original"], "capa.png", { type: "image/png" }));

    expect(fillRect).toHaveBeenCalledWith(0, 0, 640, 960);
    expect(colorAtFill).toBe("#fff");
    const lastDraw = drawImage.mock.invocationCallOrder.at(-1) ?? 0;
    expect(fillRect.mock.invocationCallOrder[0]).toBeLessThan(lastDraw);
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
