// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { bunnyLowestMp4Url, deleteBunnyCaption, putBunnyCaption } from "./server";

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubEnv("BUNNY_STREAM_API_KEY", "local-bunny-test-key");
  vi.stubEnv("NEXT_PUBLIC_BUNNY_STREAM_LIBRARY_ID", "lib-1");
  vi.stubEnv("BUNNY_STREAM_CDN_HOSTNAME", "vz-test.b-cdn.net");
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

it("points at the 240p MP4 on the library CDN", () => {
  expect(bunnyLowestMp4Url("vid 1")).toBe("https://vz-test.b-cdn.net/vid%201/play_240p.mp4");
});

it("uploads captions as base64 under the language code", async () => {
  fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
  await putBunnyCaption("vid-1", "es", "Spanish", "WEBVTT\n\nñ");
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe("https://video.bunnycdn.com/library/lib-1/videos/vid-1/captions/es");
  const body = JSON.parse(init.body);
  expect(body).toMatchObject({ srclang: "es", label: "Spanish" });
  expect(Buffer.from(body.captionsFile, "base64").toString("utf8")).toBe("WEBVTT\n\nñ");
});

it("treats a caption that is already gone as removed, and fails on other errors", async () => {
  fetchMock.mockResolvedValueOnce(new Response("", { status: 404 }));
  await expect(deleteBunnyCaption("vid-1", "en")).resolves.toBeUndefined();
  fetchMock.mockResolvedValueOnce(new Response("", { status: 500 }));
  await expect(putBunnyCaption("vid-1", "en", "English", "WEBVTT")).rejects.toThrow("500");
});
