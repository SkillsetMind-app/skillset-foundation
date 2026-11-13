import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ffmpegPath from "ffmpeg-static";

// Áudio da aula para a transcrição. O Whisper aceita até 25 MB por arquivo; o
// MP4 de 240p da Bunny tem ~3,4 MB por minuto (medido: 197 s = 11,1 MB), ou
// seja, só 7 minutos de aula caberiam inteiros. O ffmpeg tira só a voz (mono,
// 16 kHz, opus 32 kbps: ~0,24 MB por minuto) e corta em pedaços de 20 minutos,
// que vão em paralelo para a OpenAI e voltam juntos com o deslocamento de cada um.
//
// O ffmpeg lê o MP4 direto da CDN (sem baixar o vídeo inteiro antes) e escreve
// os pedaços em /tmp, que é apagado no fim, com erro ou sem.

export const CHUNK_SECONDS = 20 * 60;

export class AudioExtractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AudioExtractError";
  }
}

function run(binary: string, args: string[], signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "ignore", "pipe"], signal });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-500);
    });
    child.on("error", (error) => reject(new AudioExtractError(`ffmpeg_spawn: ${error.message}`)));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new AudioExtractError(`ffmpeg_exit_${code}: ${stderr.trim()}`));
    });
  });
}

/**
 * Pedaços de áudio de um vídeo, na ordem, cada um com o segundo em que começa.
 * `referer` vai no pedido à CDN: a biblioteca recusa pedido sem Referer (403).
 */
export async function extractAudioChunks(
  videoUrl: string,
  referer: string,
  signal?: AbortSignal,
): Promise<{ data: Uint8Array<ArrayBuffer>; offset: number; fileName: string }[]> {
  if (!ffmpegPath) throw new AudioExtractError("ffmpeg_missing");
  const dir = await mkdtemp(join(tmpdir(), "aula-audio-"));
  try {
    await run(
      ffmpegPath,
      [
        "-nostdin", "-hide_banner", "-loglevel", "error",
        "-headers", `Referer: ${referer}\r\n`,
        "-i", videoUrl,
        "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "32k",
        "-f", "segment", "-segment_time", String(CHUNK_SECONDS), "-reset_timestamps", "1",
        join(dir, "part%03d.ogg"),
      ],
      signal,
    );
    const files = (await readdir(dir)).filter((name) => name.endsWith(".ogg")).sort();
    if (files.length === 0) throw new AudioExtractError("ffmpeg_no_audio");
    return await Promise.all(
      files.map(async (fileName, index) => ({
        data: new Uint8Array(await readFile(join(dir, fileName))),
        offset: index * CHUNK_SECONDS,
        fileName,
      })),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
