// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { askJson, OpenAIConfigError, OpenAIError, transcribeToVtt } from "./openai";

// Valor falso, sem o formato de chave real: só precisa ser reconhecível no erro.
const KEY = "fake-key-for-tests";

describe("openai client", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", KEY);
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("asks whisper-1 for VTT in the teacher's language", async () => {
    fetchMock.mockResolvedValue(new Response("WEBVTT\n"));
    await expect(
      transcribeToVtt({ audio: new Uint8Array([1, 2]), fileName: "part000.ogg", language: "en" }),
    ).resolves.toBe("WEBVTT\n");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
    const form = init.body as FormData;
    expect(form.get("model")).toBe("whisper-1");
    expect(form.get("response_format")).toBe("vtt");
    expect(form.get("language")).toBe("en");
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`);
  });

  it("sends a strict JSON schema and returns the parsed reply", async () => {
    fetchMock.mockResolvedValue(Response.json({ choices: [{ message: { content: '{"lines":["Hola"]}' } }] }));
    const reply = await askJson<{ lines: string[] }>({
      system: "s",
      user: "u",
      schemaName: "lines",
      schema: { type: "object" },
    });
    expect(reply).toEqual({ lines: ["Hola"] });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe("gpt-4.1-mini");
    expect(body.response_format.json_schema).toMatchObject({ name: "lines", strict: true });
  });

  it("throws a config error without a key", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    await expect(
      askJson({ system: "s", user: "u", schemaName: "x", schema: {} }),
    ).rejects.toBeInstanceOf(OpenAIConfigError);
  });

  it("names an empty balance and never repeats the key", async () => {
    fetchMock.mockResolvedValue(
      new Response(`{"error":{"code":"credit_balance_exhausted","message":"key ${KEY}"}}`, { status: 429 }),
    );
    const error = await askJson<never>({ system: "s", user: "u", schemaName: "x", schema: {} }).catch((e: OpenAIError) => e);
    expect(error).toBeInstanceOf(OpenAIError);
    expect(error.code).toBe("no_credit");
    expect(error.message).not.toContain(KEY);
  });

  it("treats a reply that is not JSON as a bad reply", async () => {
    fetchMock.mockResolvedValue(Response.json({ choices: [{ message: { content: "sure!" } }] }));
    const error = await askJson<never>({ system: "s", user: "u", schemaName: "x", schema: {} }).catch((e: OpenAIError) => e);
    expect(error.code).toBe("bad_reply");
  });
});
