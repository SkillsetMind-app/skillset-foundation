// Legenda WebVTT: só o que as ferramentas de IA do professor precisam. Ler as
// falas, montar o arquivo de novo, juntar pedaços transcritos com o deslocamento
// de cada um e tirar o texto puro (base do quiz e das sugestões).
//
// Tudo que sai daqui passa por buildVtt: o arquivo que vai para a Bunny é sempre
// o normalizado (cabeçalho, falas, nada de STYLE/NOTE/REGION colado pelo
// professor), então um texto editado à mão não carrega bloco que o player não
// entende.

export type VttCue = { start: number; end: number; text: string };

// Limite do texto da legenda: ~3x uma aula de 2 horas falada sem pausa. O
// banco tem o mesmo teto (check em lesson_captions.vtt).
export const MAX_VTT_CHARS = 500_000;

const TIME = /^(?:(\d+):)?([0-5]\d):([0-5]\d)[.,](\d{3})$/;

function parseTime(value: string): number | null {
  const match = TIME.exec(value.trim());
  if (!match) return null;
  const [, hours, minutes, seconds, millis] = match;
  return Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(seconds) + Number(millis) / 1000;
}

export function formatVttTime(totalSeconds: number): string {
  const ms = Math.max(0, Math.round(totalSeconds * 1000));
  const pad = (value: number, size = 2) => String(value).padStart(size, "0");
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(ms % 1000, 3)}`;
}

/**
 * Falas de um WebVTT. Lança se o texto não começa com "WEBVTT" ou se uma linha
 * de tempo não fecha (fim antes do começo, formato inválido): o professor vê o
 * erro em vez de publicar uma legenda que o player descarta em silêncio.
 */
export function parseVtt(vtt: string): VttCue[] {
  const text = vtt.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  if (!/^WEBVTT(?:[ \t].*)?(?:\n|$)/.test(text)) throw new Error("vtt_header");

  const cues: VttCue[] = [];
  for (const block of text.split(/\n{2,}/).slice(1)) {
    const lines = block.split("\n");
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    // NOTE, STYLE e REGION não têm linha de tempo: ficam de fora.
    if (timingIndex === -1) continue;
    const [rawStart, rawRest = ""] = lines[timingIndex].split("-->");
    const start = parseTime(rawStart);
    const end = parseTime(rawRest.trim().split(/\s+/)[0] ?? "");
    if (start === null || end === null || end <= start) throw new Error("vtt_timing");
    const cueText = lines.slice(timingIndex + 1).join("\n").trim();
    if (cueText) cues.push({ start, end, text: cueText });
  }
  if (cues.length === 0) throw new Error("vtt_empty");
  return cues;
}

export function buildVtt(cues: VttCue[]): string {
  const body = cues
    .map((cue) => `${formatVttTime(cue.start)} --> ${formatVttTime(cue.end)}\n${cue.text.trim()}`)
    .join("\n\n");
  return `WEBVTT\n\n${body}\n`;
}

/** Junta legendas transcritas em pedaços, somando a cada fala o início do pedaço. */
export function mergeVtt(parts: { vtt: string; offset: number }[]): string {
  const cues = parts.flatMap(({ vtt, offset }) => {
    // Pedaço só de silêncio: o Whisper devolve "WEBVTT" sem falas. Não é erro.
    try {
      return parseVtt(vtt).map((cue) => ({ ...cue, start: cue.start + offset, end: cue.end + offset }));
    } catch (error) {
      if ((error as Error).message === "vtt_empty") return [];
      throw error;
    }
  });
  if (cues.length === 0) throw new Error("vtt_empty");
  return buildVtt(cues);
}

/** Texto corrido da legenda, sem tempos: a "transcrição" que vai para o modelo. */
export function vttToText(vtt: string): string {
  return parseVtt(vtt)
    .map((cue) => cue.text.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ");
}
