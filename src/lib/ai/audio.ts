import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import ffmpegPath from "ffmpeg-static";

// Áudio da aula para a transcrição. O Whisper aceita até 25 MB por arquivo; o
// MP4 de 240p da Bunny tem ~3,4 MB por minuto (medido: 197 s = 11,1 MB), ou
// seja, só 7 minutos de aula caberiam inteiros. O ffmpeg tira só a voz (mono,
// 16 kHz, opus 32 kbps: ~0,24 MB por minuto) e corta em pedaços de 10 minutos,
// que vão em paralelo para a OpenAI e voltam juntos com o deslocamento de cada um.
//
// Quem baixa o MP4 é o Node, não o ffmpeg: o binário estático do ffmpeg-static
// (glibc estática) não resolve DNS sem nscd, que a Vercel não roda. O MP4 da
// Bunny é "faststart" (moov antes de mdat, conferido em 13/11), então chega
// pelo stdin sem precisar de busca. Os pedaços vão para /tmp, apagado no fim.

export const CHUNK_SECONDS = 10 * 60;

export class AudioExtractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AudioExtractError";
  }
}

async function runFfmpeg(binary: string, args: string[], input: Readable, signal?: AbortSignal): Promise<void> {
  const child = spawn(binary, args, { stdio: ["pipe", "ignore", "pipe"], signal });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-500);
  });
  const exit = new Promise<void>((resolve, reject) => {
    child.on("error", (error) => reject(new AudioExtractError(`ffmpeg_spawn: ${error.message}`)));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new AudioExtractError(`ffmpeg_exit_${code}: ${stderr.trim()}`));
    });
  });
  // Com -t o ffmpeg para de ler antes do fim do arquivo: o EPIPE que sobra
  // na entrada não é erro, quem decide é o código de saída.
  const feed = pipeline(input, child.stdin).catch(() => undefined);
  await Promise.all([exit, feed]);
}

/**
 * Pedaços de áudio de um vídeo, na ordem, cada um com o segundo em que começa.
 * `referer` vai no pedido à CDN: a biblioteca recusa pedido sem Referer (403).
 * `maxSeconds` corta o áudio no tempo que foi cobrado do teto do professor.
 */
export async function extractAudioChunks(opts: {
  videoUrl: string;
  referer: string;
  maxSeconds: number;
  signal?: AbortSignal;
}): Promise<{ data: Uint8Array<ArrayBuffer>; offset: number; fileName: string }[]> {
  if (!ffmpegPath) throw new AudioExtractError("ffmpeg_missing");
  const response = await fetch(opts.videoUrl, { headers: { Referer: opts.referer }, signal: opts.signal })
    .catch((error: Error) => {
      throw new AudioExtractError(`video_fetch: ${error.message}`);
    });
  if (!response.ok || !response.body) {
    throw new AudioExtractError(`video_fetch_${response.status}`);
  }

  const dir = await mkdtemp(join(tmpdir(), "aula-audio-"));
  try {
    await runFfmpeg(
      ffmpegPath,
      [
        "-nostdin", "-hide_banner", "-loglevel", "error",
        "-i", "pipe:0",
        "-t", String(opts.maxSeconds),
        "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "32k",
        "-f", "segment", "-segment_time", String(CHUNK_SECONDS), "-reset_timestamps", "1",
        join(dir, "part%03d.ogg"),
      ],
      Readable.fromWeb(response.body as import("node:stream/web").ReadableStream),
      opts.signal,
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
