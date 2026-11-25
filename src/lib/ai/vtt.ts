// WebVTT caption: only what the teacher's AI tools need. Reading the
// speech lines, rebuilding the file, joining transcribed chunks with the offset
// of each one and extracting plain text (basis of the quiz and the suggestions).
//
// Everything that leaves here goes through buildVtt: the file that goes to Bunny is always
// the normalized one (header, speech lines, no STYLE/NOTE/REGION pasted in by the
// teacher), so a hand-edited text does not carry a block the player does not
// understand.

export type VttCue = { start: number; end: number; text: string };

// Caption text limit: ~3x a 2-hour lesson spoken without a pause. The
// database has the same cap (check on lesson_captions.vtt).
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
 * Speech lines of a WebVTT. Throws if the text does not start with "WEBVTT" or if a timing
 * line does not hold up (end before start, invalid format): the teacher sees the
 * error instead of publishing a caption the player drops silently.
 * `lenient` (only for Whisper output, which sometimes returns a zero-duration
 * line near silence) skips the broken line instead of losing the whole lesson.
 */
export function parseVtt(vtt: string, { lenient = false } = {}): VttCue[] {
  const text = vtt.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  if (!/^WEBVTT(?:[ \t].*)?(?:\n|$)/.test(text)) throw new Error("vtt_header");

  const cues: VttCue[] = [];
  for (const block of text.split(/\n{2,}/).slice(1)) {
    const lines = block.split("\n");
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    // NOTE, STYLE and REGION have no timing line: they are left out.
    if (timingIndex === -1) continue;
    const [rawStart, rawRest = ""] = lines[timingIndex].split("-->");
    const start = parseTime(rawStart);
    const end = parseTime(rawRest.trim().split(/\s+/)[0] ?? "");
    if (start === null || end === null || end <= start) {
      if (lenient) continue;
      throw new Error("vtt_timing");
    }
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

/** Joins captions transcribed in chunks, adding the chunk's start to each line of speech. */
export function mergeVtt(parts: { vtt: string; offset: number }[]): string {
  const cues = parts.flatMap(({ vtt, offset }) => {
    // A chunk of pure silence: Whisper returns "WEBVTT" with no speech lines. Not an error.
    try {
      return parseVtt(vtt, { lenient: true }).map((cue) => ({ ...cue, start: cue.start + offset, end: cue.end + offset }));
    } catch (error) {
      if ((error as Error).message === "vtt_empty") return [];
      throw error;
    }
  });
  if (cues.length === 0) throw new Error("vtt_empty");
  return buildVtt(cues);
}

/** Running text of the caption, without times: the "transcript" that goes to the model. */
export function vttToText(vtt: string): string {
  return parseVtt(vtt)
    .map((cue) => cue.text.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ");
}
