// Capa do módulo: recorte vertical 2:3 comprimido no navegador, antes do envio.
// Uma foto de celular de 10 MB vira uns 300 KB em 640x960. Só APIs nativas
// (createImageBitmap + canvas.toBlob): nenhuma dependência nova. O servidor
// continua checando tipo, tamanho e dono como antes.

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

// A maior caixa centrada com a proporção pedida (ratio = largura / altura).
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

// Formatos que todo navegador mostra: só esses podem subir sem conversão.
const KEEPABLE_TYPES = ["image/jpeg", "image/png", "image/webp"];

export async function compressImage(file: File): Promise<File> {
  // Recusa antes de abrir: 10 MB é o teto combinado para a foto de origem.
  if (file.size > MAX_SOURCE_IMAGE_BYTES) {
    throw new ImageTooLargeError();
  }

  // GIF pode ser animado; o canvas guardaria só o primeiro quadro.
  if (file.type === "image/gif") {
    return file;
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // HEIC em alguns navegadores, arquivo que não é imagem ou navegador sem a
    // API: sobe o original, sem mexer.
    return file;
  }

  try {
    const ratio = TARGET_WIDTH / TARGET_HEIGHT;
    const box = cropTo(bitmap.width, bitmap.height, ratio);
    // Não amplia: foto estreita sai com a largura do recorte, ainda 2:3.
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
    // Navegador sem codificador WebP devolve outro tipo (PNG): aí vai JPEG.
    let blob = await encode(canvas, "image/webp");
    if (!blob || blob.type !== "image/webp") {
      // JPEG não tem transparência: sem fundo branco, o transparente sai preto.
      context.fillStyle = "#fff";
      context.fillRect(0, 0, width, height);
      draw();
      blob = await encode(canvas, "image/jpeg");
    }
    if (!blob || (blob.type !== "image/webp" && blob.type !== "image/jpeg")) {
      return file;
    }

    // Já 2:3, num formato que todo navegador mostra, e a conversão não
    // diminuiu: sobe o original.
    const alreadyCover = Math.abs(bitmap.width / bitmap.height - ratio) < 0.01;
    if (blob.size >= file.size && alreadyCover && KEEPABLE_TYPES.includes(file.type)) {
      return file;
    }

    return new File([blob], renamed(file.name, blob.type), { type: blob.type });
  } finally {
    bitmap.close?.();
  }
}
