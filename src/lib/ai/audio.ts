import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import ffmpegPath from "ffmpeg-static";

// Lesson audio for the transcription. Whisper accepts up to 25 MB per file; the
// Bunny 240p MP4 takes ~3.4 MB per minute (measured: 197 s = 11.1 MB), which
// means only 7 minutes of a lesson would fit whole. ffmpeg keeps only the voice (mono,
// 16 kHz, opus 32 kbps: ~0.24 MB per minute) and cuts it into 10-minute chunks,
// which go to OpenAI in parallel and come back together with the offset of each one.
//
// Node downloads the MP4, not ffmpeg: the static ffmpeg-static binary
// (static glibc) cannot resolve DNS without nscd, which Vercel does not run. The Bunny
// MP4 is "faststart" (moov before mdat, checked on Nov 13), so it arrives
// through stdin without needing to seek. The chunks go to /tmp, deleted at the end.

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
  // With -t ffmpeg stops reading before the end of the file: the EPIPE left over
  // on the input is not an error, the exit code decides.
  const feed = pipeline(input, child.stdin).catch(() => undefined);
  await Promise.all([exit, feed]);
}

/**
 * Audio chunks of a video, in order, each with the second where it starts.
 * `referer` goes in the CDN request: the library refuses a request without Referer (403).
 * `maxSeconds` cuts the audio at the time that was charged against the teacher's cap.
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

  const dir = await mkdtemp(join(tmpdir(), "lesson-audio-"));
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
