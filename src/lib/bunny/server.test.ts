// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

import { bunnyLowestMp4Url, deleteBunnyCaption, getBunnyCaptionLanguages, putBunnyCaption } from "./server";

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

// Com a chave do player, o link sai assinado no formato do token avançado da
// CDN: "HS256-" + Base64URL sem "=" do HMAC-SHA256(chave, caminho + expires).
it("signs the 240p MP4 with the library token key when there is one", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-24T00:00:00Z"));
  vi.stubEnv("BUNNY_STREAM_TOKEN_KEY", "local-token-key");
  try {
    const expires = Math.floor(Date.parse("2026-11-24T00:00:00Z") / 1000) + 300;
    const url = new URL(bunnyLowestMp4Url("vid-1"));
    expect(`${url.origin}${url.pathname}`).toBe("https://vz-test.b-cdn.net/vid-1/play_240p.mp4");
    expect(url.searchParams.get("expires")).toBe(String(expires));
    const expected = createHmac("sha256", "local-token-key").update(`/vid-1/play_240p.mp4${expires}`).digest("base64url");
    expect(url.searchParams.get("token")).toBe(`HS256-${expected}`);
    expect(url.searchParams.get("token")).not.toMatch(/[+/=]/);
  } finally {
    vi.useRealTimers();
  }
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

it("reads the caption languages already on the video, and fails instead of guessing", async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ captions: [{ srclang: "EN", label: "English" }, { label: "no code" }] }));
  await expect(getBunnyCaptionLanguages("vid-1")).resolves.toEqual(["en"]);
  expect(fetchMock.mock.calls[0][0]).toBe("https://video.bunnycdn.com/library/lib-1/videos/vid-1");
  fetchMock.mockResolvedValueOnce(Response.json({}));
  await expect(getBunnyCaptionLanguages("vid-1")).resolves.toEqual([]);
  fetchMock.mockResolvedValueOnce(new Response("", { status: 500 }));
  await expect(getBunnyCaptionLanguages("vid-1")).rejects.toThrow("500");
});
