import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  compressImage,
  cropTo,
  ImageTooLargeError,
  MAX_SOURCE_IMAGE_BYTES,
} from "@/lib/media/compress-image";

// The module cover is vertical 2:3 and compressed in the browser: 10 MB go in,
// about 300 KB come out. jsdom has neither createImageBitmap nor a real canvas, so
// both are stubbed here; the crop math is pure.

describe("cropTo", () => {
  it("square 1000x1000 to 2:3 crops the sides, at the center", () => {
    expect(cropTo(1000, 1000, 2 / 3)).toEqual({ x: 167, y: 0, w: 667, h: 1000 });
  });

  it("landscape 1920x1080 crops the sides", () => {
    expect(cropTo(1920, 1080, 2 / 3)).toEqual({ x: 600, y: 0, w: 720, h: 1080 });
  });

  it("portrait 1000x2000 crops the top and bottom", () => {
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

  it("crops 2:3 at the center to 640x960 and returns WebP at quality 0.82", async () => {
    const out = await compressImage(new File(["original"], "capa.png", { type: "image/png" }));

    // 3000x2000 -> box of 1333x2000 centered at x = 834.
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 834, 0, 1333, 2000, 0, 0, 640, 960);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/webp", 0.82);
    expect(out.type).toBe("image/webp");
    expect(out.name).toBe("capa.webp");
    // WebP keeps transparency: no white background here.
    expect(fillRect).not.toHaveBeenCalled();
  });

  it("turns on high smoothing before drawing (the downscale has no jagged edges)", async () => {
    let qualityAtDraw = "";
    drawImage.mockImplementation(() => {
      qualityAtDraw = context.imageSmoothingQuality;
    });

    await compressImage(new File(["original"], "capa.png", { type: "image/png" }));

    expect(qualityAtDraw).toBe("high");
  });

  it("a small photo is not enlarged: 500x600 comes out 400x600, still 2:3", async () => {
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

  it("already 2:3, common type and the compression did not shrink it: the original stays", async () => {
    vi.mocked(createImageBitmap).mockResolvedValue(bitmapOf(640, 960));
    // "comprimido" (10 bytes) is not smaller than "original" (8 bytes).
    const png = new File(["original"], "capa.png", { type: "image/png" });

    await expect(compressImage(png)).resolves.toBe(png);

    // HEIC does not stay as is: not every browser shows it.
    const heic = new File(["original"], "capa.heic", { type: "image/heic" });
    expect((await compressImage(heic)).type).toBe("image/webp");
  });

  it("GIF (may be animated) uploads the original, but the 10 MB ceiling still applies", async () => {
    const gif = new File(["GIF89a"], "capa.gif", { type: "image/gif" });

    await expect(compressImage(gif)).resolves.toBe(gif);
    expect(createImageBitmap).not.toHaveBeenCalled();

    const bigGif = new File(["x"], "enorme.gif", { type: "image/gif" });
    Object.defineProperty(bigGif, "size", { value: MAX_SOURCE_IMAGE_BYTES + 1 });
    await expect(compressImage(bigGif)).rejects.toBeInstanceOf(ImageTooLargeError);
  });

  it("a browser without WebP (toBlob returns another type) falls back to JPEG", async () => {
    toBlob.mockImplementation((callback: BlobCallback, type?: string) => {
      callback(new Blob(["comprimido"], { type: type === "image/webp" ? "image/png" : type }));
    });

    const out = await compressImage(new File(["original"], "capa.png", { type: "image/png" }));

    expect(toBlob).toHaveBeenLastCalledWith(expect.any(Function), "image/jpeg", 0.82);
    expect(out.type).toBe("image/jpeg");
    expect(out.name).toBe("capa.jpg");
  });

  it("for JPEG it paints the background white before drawing (a transparent PNG does not turn black)", async () => {
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

  it("refuses a file above 10 MB before compressing", async () => {
    const big = new File(["x"], "enorme.jpg", { type: "image/jpeg" });
    Object.defineProperty(big, "size", { value: MAX_SOURCE_IMAGE_BYTES + 1 });

    await expect(compressImage(big)).rejects.toBeInstanceOf(ImageTooLargeError);
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it("if the browser cannot open the image (HEIC), returns the original untouched", async () => {
    vi.mocked(createImageBitmap).mockRejectedValueOnce(new Error("unsupported format"));
    const heic = new File(["original"], "foto.heic", { type: "image/heic" });

    await expect(compressImage(heic)).resolves.toBe(heic);
    expect(toBlob).not.toHaveBeenCalled();
  });
});
