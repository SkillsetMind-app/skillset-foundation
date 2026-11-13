// @vitest-environment node
import { EventEmitter } from "node:events";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Writable } from "node:stream";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn: spawnMock }));
vi.mock("ffmpeg-static", () => ({ default: "/bin/ffmpeg" }));

import { AudioExtractError, CHUNK_SECONDS, extractAudioChunks } from "./audio";

const fetchMock = vi.fn();
let fed = "";

function fakeFfmpeg(exitCode: number, files: string[] = []) {
  spawnMock.mockImplementation((_binary: string, args: string[]) => {
    fed = "";
    const stdin = new Writable({
      write(chunk, _encoding, done) {
        fed += chunk.toString();
        done();
      },
    });
    const child = Object.assign(new EventEmitter(), { stderr: new EventEmitter(), stdin });
    stdin.on("finish", () => {
      const outDir = dirname(args.at(-1)!);
      for (const name of files) writeFileSync(join(outDir, name), name);
      if (exitCode !== 0) child.stderr.emit("data", Buffer.from("Invalid data found when processing input"));
      child.emit("close", exitCode);
    });
    return child;
  });
}

const options = { videoUrl: "https://cdn.example/v/play_240p.mp4", referer: "https://skillsetmind.com/", maxSeconds: 125 };

describe("extractAudioChunks", () => {
  beforeEach(() => {
    spawnMock.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(new Response("mp4-bytes"));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("downloads with the Referer in Node, feeds ffmpeg through stdin and returns ordered chunks", async () => {
    fakeFfmpeg(0, ["part001.ogg", "part000.ogg"]);
    const chunks = await extractAudioChunks(options);

    expect(fetchMock.mock.calls[0][0]).toBe(options.videoUrl);
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ Referer: "https://skillsetmind.com/" });
    expect(fed).toBe("mp4-bytes");
    const args: string[] = spawnMock.mock.calls[0][1];
    expect(args[args.indexOf("-i") + 1]).toBe("pipe:0");
    expect(args[args.indexOf("-t") + 1]).toBe("125");
    expect(args[args.indexOf("-segment_time") + 1]).toBe(String(CHUNK_SECONDS));
    expect(args).toContain("libopus");
    expect(chunks.map((c) => [c.fileName, c.offset])).toEqual([["part000.ogg", 0], ["part001.ogg", CHUNK_SECONDS]]);
    // A pasta temporária some no fim.
    expect(existsSync(dirname(args.at(-1)!))).toBe(false);
  });

  it("stops before ffmpeg when the CDN refuses the video", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 403 }));
    const error = await extractAudioChunks(options).catch((e: AudioExtractError) => e);
    expect(error).toBeInstanceOf(AudioExtractError);
    expect(error.message).toBe("video_fetch_403");
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("fails with ffmpeg's last words and still cleans up", async () => {
    fakeFfmpeg(1);
    const error = await extractAudioChunks(options).catch((e: AudioExtractError) => e);
    expect(error).toBeInstanceOf(AudioExtractError);
    expect(error.message).toContain("Invalid data");
    const args: string[] = spawnMock.mock.calls[0][1];
    expect(existsSync(dirname(args.at(-1)!))).toBe(false);
  });
});
