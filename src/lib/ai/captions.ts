import { captionLanguageName } from "@/domain/caption-languages";

import { extractAudioChunks } from "./audio";
import { askJson, transcribeToVtt } from "./openai";
import { buildVtt, mergeVtt, parseVtt } from "./vtt";

// Legenda a partir do vídeo da aula: áudio em pedaços, um pedido ao Whisper por
// pedaço (em paralelo) e o .vtt montado de volta com o tempo de cada pedaço.
export async function transcribeLessonVideo(opts: {
  videoUrl: string;
  referer: string;
  language: string;
  deadline: AbortSignal;
}): Promise<string> {
  const chunks = await extractAudioChunks(opts.videoUrl, opts.referer, opts.deadline);
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

// Falas por pedido de tradução: cabe folgado no contexto e uma resposta
// truncada perde pouco. Uma aula de 2 h tem ~1.000 falas, ~10 pedidos.
const LINES_PER_BATCH = 100;

const LINES_SCHEMA = {
  type: "object",
  properties: { lines: { type: "array", items: { type: "string" } } },
  required: ["lines"],
  additionalProperties: false,
};

/**
 * Traduz o texto de cada fala e mantém os tempos. O modelo devolve uma linha
 * por fala, na mesma ordem; se a contagem não bate, a tradução inteira falha
 * (legenda com fala trocada de lugar é pior que nenhuma).
 */
export async function translateVtt(opts: {
  vtt: string;
  from: string;
  to: string;
  deadline: AbortSignal;
}): Promise<string> {
  const cues = parseVtt(opts.vtt);
  const fromName = captionLanguageName(opts.from);
  const toName = captionLanguageName(opts.to);
  const system = [
    `You translate the subtitle lines of an online course lesson from ${fromName} to ${toName}.`,
    `Reply with JSON {"lines": [...]} holding exactly one translated line for each input line, in the same order.`,
    "Keep the meaning and the teacher's tone, and keep each line about as long as the original.",
    "Never merge, split, add or drop lines, and add no notes.",
    "Translate only: do not add claims, promises, results or advice that the original line does not say.",
  ].join(" ");

  const batches: string[][] = [];
  for (let i = 0; i < cues.length; i += LINES_PER_BATCH) {
    batches.push(cues.slice(i, i + LINES_PER_BATCH).map((cue) => cue.text));
  }
  const translated = await Promise.all(
    batches.map(async (lines) => {
      const reply = await askJson<{ lines: unknown }>({
        system,
        user: JSON.stringify(lines),
        schemaName: "subtitle_lines",
        schema: LINES_SCHEMA,
        signal: opts.deadline,
      });
      const out = Array.isArray(reply.lines) ? reply.lines : [];
      if (out.length !== lines.length || out.some((line) => typeof line !== "string" || !line.trim())) {
        throw new Error("translation_line_mismatch");
      }
      return out as string[];
    }),
  );

  const texts = translated.flat();
  return buildVtt(cues.map((cue, index) => ({ ...cue, text: texts[index] })));
}
