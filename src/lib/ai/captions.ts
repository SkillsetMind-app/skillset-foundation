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
  maxSeconds: number;
  deadline: AbortSignal;
  /** Chamado antes do primeiro pedido à OpenAI: dali em diante há custo. */
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

// Falas por pedido de tradução: cabe folgado no contexto e uma resposta
// truncada perde pouco. Uma aula de 2 h tem ~1.000 falas, ~10 pedidos.
const LINES_PER_BATCH = 100;
// Pedidos ao mesmo tempo: não esgota o limite de taxa da conta da OpenAI, que é
// o mesmo para todos os professores.
const PARALLEL_BATCHES = 4;
// Legenda de origem maior que isso não é de uma aula de 2 h: foi editada à mão
// para crescer. Recusa antes de gastar.
export const MAX_TRANSLATE_CUES = 2_000;
export const MAX_TRANSLATE_CHARS = 150_000;

const LINES_SCHEMA = {
  type: "object",
  properties: { lines: { type: "array", items: { type: "string" } } },
  required: ["lines"],
  additionalProperties: false,
};

/**
 * Traduz o texto de cada fala e mantém os tempos. O modelo devolve uma linha
 * por fala, na mesma ordem; se a contagem não bate nem na segunda tentativa, a
 * tradução inteira falha (legenda com fala trocada de lugar é pior que nenhuma).
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
  // ponytail: fila simples com N trabalhadores; uma falha derruba o resto
  // pelo Promise.all, e os lotes já enviados terminam sozinhos.
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
