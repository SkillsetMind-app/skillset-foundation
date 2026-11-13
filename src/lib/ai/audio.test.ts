// @vitest-environment node
import { EventEmitter } from "node:events";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn: spawnMock }));
vi.mock("ffmpeg-static", () => ({ default: "/bin/ffmpeg" }));

import { AudioExtractError, CHUNK_SECONDS, extractAudioChunks } from "./audio";

function fakeFfmpeg(exitCode: number, files: string[] = []) {
  spawnMock.mockImplementation((_binary: string, args: string[]) => {
    const child = Object.assign(new EventEmitter(), { stderr: new EventEmitter() });
    const outDir = dirname(args.at(-1)!);
    queueMicrotask(() => {
      for (const name of files) writeFileSync(join(outDir, name), name);
      if (exitCode !== 0) child.stderr.emit("data", Buffer.from("Server returned 403 Forbidden"));
      child.emit("close", exitCode);
    });
    return child;
  });
}

describe("extractAudioChunks", () => {
  beforeEach(() => spawnMock.mockReset());

  it("sends the Referer, cuts 20-minute opus chunks and returns them in order with offsets", async () => {
    fakeFfmpeg(0, ["part001.ogg", "part000.ogg"]);
    const chunks = await extractAudioChunks("https://cdn.example/v/play_240p.mp4", "https://skillsetmind.com/");

    const args: string[] = spawnMock.mock.calls[0][1];
    expect(args[args.indexOf("-headers") + 1]).toBe("Referer: https://skillsetmind.com/\r\n");
    expect(args[args.indexOf("-segment_time") + 1]).toBe(String(CHUNK_SECONDS));
    expect(args).toContain("libopus");
    expect(chunks.map((c) => [c.fileName, c.offset])).toEqual([["part000.ogg", 0], ["part001.ogg", CHUNK_SECONDS]]);
    // A pasta temporária some no fim.
    expect(existsSync(dirname(args.at(-1)!))).toBe(false);
  });

  it("fails with ffmpeg's last words and still cleans up", async () => {
    fakeFfmpeg(1);
    const error = await extractAudioChunks("https://cdn.example/x", "https://skillsetmind.com/").catch((e) => e);
    expect(error).toBeInstanceOf(AudioExtractError);
    expect(error.message).toContain("403");
    const args: string[] = spawnMock.mock.calls[0][1];
    expect(existsSync(dirname(args.at(-1)!))).toBe(false);
  });
});
