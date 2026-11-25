// Module cover: a vertical 2:3 crop compressed in the browser, before upload.
// A 10 MB phone photo becomes about 300 KB at 640x960. Only native APIs
// (createImageBitmap + canvas.toBlob): no new dependency. The server
// still checks type, size and owner as before.

export const MAX_SOURCE_IMAGE_BYTES = 10 * 1024 * 1024;

const TARGET_WIDTH = 640;
const TARGET_HEIGHT = 960;
const QUALITY = 0.82;

export type CropBox = { x: number; y: number; w: number; h: number };

export class ImageTooLargeError extends Error {
  constructor() {
    super("Image is over 10 MB.");
    this.name = "ImageTooLargeError";
  }
}

// The largest centered box with the requested ratio (ratio = width / height).
export function cropTo(width: number, height: number, ratio: number): CropBox {
  if (width / height > ratio) {
    const w = Math.round(height * ratio);
    return { x: Math.round((width - w) / 2), y: 0, w, h: height };
  }

  const h = Math.round(width / ratio);
  return { x: 0, y: Math.round((height - h) / 2), w: width, h };
}

function encode(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY));
}

function renamed(name: string, type: string): string {
  const base = name.replace(/\.[^./\\]+$/, "") || "cover";
  return `${base}.${type === "image/webp" ? "webp" : "jpg"}`;
}

// Formats that every browser shows: only these can be uploaded without conversion.
const KEEPABLE_TYPES = ["image/jpeg", "image/png", "image/webp"];

export async function compressImage(file: File): Promise<File> {
  // Refuses before opening: 10 MB is the agreed ceiling for the source photo.
  if (file.size > MAX_SOURCE_IMAGE_BYTES) {
    throw new ImageTooLargeError();
  }

  // A GIF may be animated; the canvas would keep only the first frame.
  if (file.type === "image/gif") {
    return file;
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // HEIC in some browsers, a file that is not an image, or a browser without the
    // API: uploads the original, untouched.
    return file;
  }

  try {
    const ratio = TARGET_WIDTH / TARGET_HEIGHT;
    const box = cropTo(bitmap.width, bitmap.height, ratio);
    // Does not enlarge: a narrow photo comes out at the crop's width, still 2:3.
    const width = Math.min(TARGET_WIDTH, box.w);
    const height = Math.round(width / ratio);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      return file;
    }

    const draw = () => {
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(bitmap, box.x, box.y, box.w, box.h, 0, 0, width, height);
    };
    draw();
    // A browser without a WebP encoder returns another type (PNG): then it goes to JPEG.
    let blob = await encode(canvas, "image/webp");
    if (!blob || blob.type !== "image/webp") {
      // JPEG has no transparency: without a white background, the transparent part comes out black.
      context.fillStyle = "#fff";
      context.fillRect(0, 0, width, height);
      draw();
      blob = await encode(canvas, "image/jpeg");
    }
    if (!blob || (blob.type !== "image/webp" && blob.type !== "image/jpeg")) {
      return file;
    }

    // Already 2:3, in a format every browser shows, and the conversion did not
    // shrink it: uploads the original.
    const alreadyCover = Math.abs(bitmap.width / bitmap.height - ratio) < 0.01;
    if (blob.size >= file.size && alreadyCover && KEEPABLE_TYPES.includes(file.type)) {
      return file;
    }

    return new File([blob], renamed(file.name, blob.type), { type: blob.type });
  } finally {
    bitmap.close?.();
  }
}
