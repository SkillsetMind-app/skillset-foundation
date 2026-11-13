// @vitest-environment node
import { describe, expect, it } from "vitest";

import { buildVtt, formatVttTime, mergeVtt, parseVtt, vttToText } from "./vtt";

const whisper = `WEBVTT

00:00:00.000 --> 00:00:04.200
Welcome to the first lesson.

00:00:04.200 --> 00:00:09.000
Today we talk about habits.
`;

describe("vtt", () => {
  it("reads the cues Whisper returns", () => {
    expect(parseVtt(whisper)).toEqual([
      { start: 0, end: 4.2, text: "Welcome to the first lesson." },
      { start: 4.2, end: 9, text: "Today we talk about habits." },
    ]);
  });

  it("accepts mm:ss timings, CRLF, cue ids and cue settings, and drops NOTE/STYLE blocks", () => {
    const edited = "WEBVTT\r\n\r\nNOTE edited by hand\r\n\r\nSTYLE\r\n::cue { color: red }\r\n\r\n1\r\n00:05.000 --> 00:06.500 align:start\r\nHi\r\n";
    expect(parseVtt(edited)).toEqual([{ start: 5, end: 6.5, text: "Hi" }]);
    expect(buildVtt(parseVtt(edited))).toBe("WEBVTT\n\n00:00:05.000 --> 00:00:06.500\nHi\n");
  });

  it("rejects a file without header, a broken timing line or no cues", () => {
    expect(() => parseVtt("00:00:01.000 --> 00:00:02.000\nHi")).toThrow("vtt_header");
    expect(() => parseVtt("WEBVTT\n\n00:00:03.000 --> 00:00:02.000\nHi")).toThrow("vtt_timing");
    expect(() => parseVtt("WEBVTT\n\n00:00:01.000 --> soon\nHi")).toThrow("vtt_timing");
    expect(() => parseVtt("WEBVTT\n")).toThrow("vtt_empty");
  });

  it("shifts each chunk by its offset and skips a silent chunk", () => {
    const merged = mergeVtt([
      { vtt: whisper, offset: 0 },
      { vtt: "WEBVTT\n", offset: 1200 },
      { vtt: "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nLast part.\n", offset: 2400 },
    ]);
    expect(parseVtt(merged).at(-1)).toEqual({ start: 2401, end: 2402, text: "Last part." });
    expect(parseVtt(merged)).toHaveLength(3);
  });

  it("formats hours past 99 minutes", () => {
    expect(formatVttTime(3725.5)).toBe("01:02:05.500");
  });

  it("turns cues into plain text without tags", () => {
    expect(vttToText("WEBVTT\n\n00:00.000 --> 00:01.000\n<v Ana>Hello\nthere</v>\n")).toBe("Hello there");
  });
});
