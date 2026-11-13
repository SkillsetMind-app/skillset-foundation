// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  extractAudioChunks: vi.fn(),
  transcribeToVtt: vi.fn(),
  askJson: vi.fn(),
}));
vi.mock("./audio", () => ({ extractAudioChunks: mocks.extractAudioChunks }));
vi.mock("./openai", () => ({ transcribeToVtt: mocks.transcribeToVtt, askJson: mocks.askJson }));

import { transcribeLessonVideo, translateVtt } from "./captions";
import { parseVtt } from "./vtt";

const deadline = new AbortController().signal;

describe("transcribeLessonVideo", () => {
  beforeEach(() => Object.values(mocks).forEach((mock) => mock.mockReset()));

  it("transcribes every chunk in the teacher's language and stitches them in time", async () => {
    mocks.extractAudioChunks.mockResolvedValue([
      { data: new Uint8Array([1]), offset: 0, fileName: "part000.ogg" },
      { data: new Uint8Array([2]), offset: 1200, fileName: "part001.ogg" },
    ]);
    mocks.transcribeToVtt.mockImplementation(async ({ fileName }: { fileName: string }) =>
      `WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n${fileName}\n`,
    );
    const vtt = await transcribeLessonVideo({ videoUrl: "u", referer: "r", language: "es", deadline });
    expect(mocks.transcribeToVtt.mock.calls.every(([opts]) => opts.language === "es")).toBe(true);
    expect(parseVtt(vtt).map((cue) => [cue.start, cue.text])).toEqual([[1, "part000.ogg"], [1201, "part001.ogg"]]);
  });
});

describe("translateVtt", () => {
  beforeEach(() => Object.values(mocks).forEach((mock) => mock.mockReset()));
  const source = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n\n00:00:02.000 --> 00:00:03.000\nBye\n";

  it("keeps every timing and swaps only the text", async () => {
    mocks.askJson.mockResolvedValue({ lines: ["Hola", "Adiós"] });
    const out = await translateVtt({ vtt: source, from: "en", to: "es", deadline });
    expect(parseVtt(out)).toEqual([
      { start: 1, end: 2, text: "Hola" },
      { start: 2, end: 3, text: "Adiós" },
    ]);
    expect(mocks.askJson.mock.calls[0][0].system).toContain("from English to Spanish");
  });

  it("fails instead of shifting lines when the model drops one", async () => {
    mocks.askJson.mockResolvedValue({ lines: ["Hola"] });
    await expect(translateVtt({ vtt: source, from: "en", to: "es", deadline })).rejects.toThrow(
      "translation_line_mismatch",
    );
  });
});
