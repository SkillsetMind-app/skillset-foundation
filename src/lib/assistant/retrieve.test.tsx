import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ embedChunks: vi.fn() }));

vi.mock("./knowledge-sync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./knowledge-sync")>()),
  embedChunks: mocks.embedChunks,
}));

import { formatKnowledge, retrieveKnowledge } from "./retrieve";

function client(rpc: ReturnType<typeof vi.fn>) {
  return { rpc } as unknown as SupabaseClient;
}

describe("retrieveKnowledge", () => {
  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    mocks.embedChunks.mockResolvedValue([[0.1, 0.2]]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("returns the matched passages and asks for a similarity floor", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ content: "REFUND_POLICY", similarity: 0.9 }],
      error: null,
    });

    expect(await retrieveKnowledge(client(rpc), "how do refunds work?")).toEqual([
      "REFUND_POLICY",
    ]);

    // The floor is the whole reason "I don't have that information" is reachable:
    // a plain top-k would hand the model five irrelevant chunks and invite it to
    // answer from them. Dropping match_threshold here silently re-enables that.
    const [name, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(name).toBe("match_advisor_documents");
    expect(args.match_threshold).toBeGreaterThan(0);
    expect(args.match_count).toBeGreaterThan(0);
  });

  // The three ways retrieval can fail. In every one of them the advisor must
  // still answer from the teacher's own data and the static knowledge block --
  // a broken knowledge base degrades the reply, it never 500s the request.
  it("returns nothing when the embedding call throws", async () => {
    mocks.embedChunks.mockRejectedValue(new Error("openai down"));
    const rpc = vi.fn();

    await expect(retrieveKnowledge(client(rpc), "anything")).resolves.toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns nothing when the rpc reports an error", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "no pgvector" } });

    await expect(retrieveKnowledge(client(rpc), "anything")).resolves.toEqual([]);
  });

  it("skips the round trip when there is no key or no question", async () => {
    const rpc = vi.fn();

    vi.stubEnv("OPENAI_API_KEY", "");
    await expect(retrieveKnowledge(client(rpc), "anything")).resolves.toEqual([]);

    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    await expect(retrieveKnowledge(client(rpc), "   ")).resolves.toEqual([]);

    expect(mocks.embedChunks).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("formatKnowledge", () => {
  it("is empty when nothing was retrieved, so no empty header reaches the prompt", () => {
    expect(formatKnowledge([])).toBe("");
  });

  it("labels the passages as authoritative platform knowledge", () => {
    const block = formatKnowledge(["A", "B"]);
    expect(block).toContain("knowledge base");
    expect(block).toContain("A");
    expect(block).toContain("B");
  });
});
