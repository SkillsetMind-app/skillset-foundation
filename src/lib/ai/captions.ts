import { captionLanguageName } from "@/domain/caption-languages";

import { extractAudioChunks } from "./audio";
import { askJson, transcribeToVtt } from "./openai";
import { buildVtt, mergeVtt, parseVtt } from "./vtt";

// Captions from the lesson video: audio in chunks, one Whisper request per
// chunk (in parallel) and the .vtt put back together with the time of each chunk.
export async function transcribeLessonVideo(opts: {
  videoUrl: string;
  referer: string;
  language: string;
  maxSeconds: number;
  deadline: AbortSignal;
  /** Called before the first request to OpenAI: from there on there is a cost. */
  onSpend?: () => void;
}): Promise<string> {
  const chunks = await extractAudioChunks({
    videoUrl: opts.videoUrl,
    referer: opts.referer,
    maxSeconds: opts.maxSeconds,
    signal: opts.deadline,
  });
  opts.onSpend?.();
  const parts = await Promise.all(
    chunks.map(async (chunk) => ({
      offset: chunk.offset,
      vtt: await transcribeToVtt({
        audio: chunk.data,
        fileName: chunk.fileName,
        language: opts.language,
        signal: opts.deadline,
      }),
    })),
  );
  return mergeVtt(parts);
}

// Lines of speech per translation request: fits comfortably in the context and a
// truncated answer loses little. A 2 h lesson has ~1,000 lines, ~10 requests.
const LINES_PER_BATCH = 100;
// Requests at the same time: does not exhaust the rate limit of the OpenAI account, which is
// the same for all teachers.
const PARALLEL_BATCHES = 4;
// A source caption bigger than this is not from a 2 h lesson: it was edited by hand
// to grow. Refused before spending.
export const MAX_TRANSLATE_CUES = 2_000;
export const MAX_TRANSLATE_CHARS = 150_000;

const LINES_SCHEMA = {
  type: "object",
  properties: { lines: { type: "array", items: { type: "string" } } },
  required: ["lines"],
  additionalProperties: false,
};

/**
 * Translates the text of each line of speech and keeps the times. The model returns one line
 * per line of speech, in the same order; if the count does not match even on the second attempt, the
 * whole translation fails (a caption with speech swapped around is worse than none).
 */
export async function translateVtt(opts: {
  vtt: string;
  from: string;
  to: string;
  deadline: AbortSignal;
}): Promise<string> {
  const cues = parseVtt(opts.vtt);
  if (cues.length > MAX_TRANSLATE_CUES || opts.vtt.length > MAX_TRANSLATE_CHARS) {
    throw new Error("translation_too_long");
  }
  const system = [
    `You translate the subtitle lines of an online course lesson from ${captionLanguageName(opts.from)} to ${captionLanguageName(opts.to)}.`,
    `Reply with JSON {"lines": [...]} holding exactly one translated line for each input line, in the same order.`,
    "Keep the meaning and the teacher's tone, and keep each line about as long as the original.",
    "Never merge, split, add or drop lines, and add no notes.",
    "Translate only: do not add claims, promises, results or advice that the original line does not say.",
  ].join(" ");

  const batches: string[][] = [];
  for (let i = 0; i < cues.length; i += LINES_PER_BATCH) {
    batches.push(cues.slice(i, i + LINES_PER_BATCH).map((cue) => cue.text));
  }

  async function translateBatch(lines: string[], attempt = 1): Promise<string[]> {
    const reply = await askJson<{ lines: unknown }>({
      system,
      user: JSON.stringify(lines),
      schemaName: "subtitle_lines",
      schema: LINES_SCHEMA,
      signal: opts.deadline,
    });
    const out = Array.isArray(reply.lines) ? reply.lines : [];
    if (out.length === lines.length && out.every((line) => typeof line === "string" && line.trim())) {
      return out as string[];
    }
    if (attempt < 2) return translateBatch(lines, attempt + 1);
    throw new Error("translation_line_mismatch");
  }

  const translated: string[][] = new Array(batches.length);
  let next = 0;
  // ponytail: simple queue with N workers; one failure takes down the rest
  // through Promise.all, and the batches already sent finish on their own.
  await Promise.all(
    Array.from({ length: Math.min(PARALLEL_BATCHES, batches.length) }, async () => {
      while (next < batches.length) {
        const index = next++;
        translated[index] = await translateBatch(batches[index]);
      }
    }),
  );

  const texts = translated.flat();
  return buildVtt(cues.map((cue, index) => ({ ...cue, text: texts[index] })));
}
