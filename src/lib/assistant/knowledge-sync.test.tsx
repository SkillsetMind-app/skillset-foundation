import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { chunkText, syncKnowledgeDoc } from "./knowledge-sync";

const DOC_URL = "https://docs.google.com/document/d/DOC123/export?format=txt";

// Duck-typed Response: only the three members fetchDocText touches, so the test
// does not depend on which Response implementation the jsdom env exposes.
function fakeResponse(body: string, contentType = "text/plain", status = 200): Response {
  return {
    ok: status < 400,
    status,
    headers: { get: () => contentType },
    text: async () => body,
  } as unknown as Response;
}

function fakeJsonResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => "application/json" },
    json: async () => payload,
  } as unknown as Response;
}

/**
 * Records the write path in call order. The order is the point: an upsert that
 * runs after the prune, or a prune that loses its source_id filter, both still
 * "work" and both destroy the index — so the test asserts the sequence and the
 * filters, not just that something was written.
 */
function recordingAdmin() {
  const calls: string[] = [];
  const upsert = vi.fn(async () => {
    calls.push("upsert");
    return { error: null };
  });
  const gte = vi.fn(async () => {
    calls.push("delete");
    return { error: null };
  });
  const eq = vi.fn(() => ({ gte }));
  const from = vi.fn(() => ({ upsert, delete: () => ({ eq }) }));
  return { client: { from } as unknown as SupabaseClient, calls, from, upsert, eq, gte };
}

describe("chunkText", () => {
  it("never cuts a word in half and never exceeds the limit", () => {
    const words = ["refunds", "payouts", "certificates", "commission", "enrollment"];
    const text = Array.from({ length: 200 }, (_, i) => words[i % words.length]).join(" ");

    const chunks = chunkText(text, 120);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(120);
      // Every token in the output is a whole token from the input: a mid-word cut
      // would produce something like "certifi" and fail here.
      for (const token of chunk.split(/\s+/)) expect(words).toContain(token);
    }
  });

  it("packs whole paragraphs together instead of cutting at the character limit", () => {
    const first = "Refunds are available for fourteen days after purchase.";
    const second = "Payouts run on the creator's own Stripe schedule.";
    const third = "Certificates can be verified from the public verify page.";

    const chunks = chunkText([first, second, third].join("\n\n"), 120);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toBe(`${first}\n\n${second}`);
    expect(chunks[1]).toContain(third);
    // The seam carries the tail of the previous chunk, so a sentence that falls
    // on the boundary is still retrievable whole.
    expect(chunks[1]).toContain("Stripe schedule.");
    expect(chunks[1].length).toBeLessThanOrEqual(120);
  });
});

describe("syncKnowledgeDoc", () => {
  const admin = { from: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("skips quietly when the doc is not configured yet, so the cron keeps running", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("ADVISOR_KNOWLEDGE_DOC_URL", undefined);

    const result = await syncKnowledgeDoc(admin as unknown as SupabaseClient);

    expect(result).toEqual({ ok: false, chunks: 0, skipped: true, reason: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(admin.from).not.toHaveBeenCalled();
  });

  // The one failure that actually happens: sharing was never set to "anyone with
  // the link", so the export URL answers with a sign-in page at HTTP 200.
  it("names the sharing setting when Google answers with HTML instead of text", async () => {
    vi.stubEnv("ADVISOR_KNOWLEDGE_DOC_URL", DOC_URL);
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        fakeResponse("<!DOCTYPE html><html><body>Sign in</body></html>", "text/html; charset=utf-8"),
      ),
    );

    const result = await syncKnowledgeDoc(admin as unknown as SupabaseClient);

    expect(result.ok).toBe(false);
    expect(result.skipped).toBe(false);
    expect(result.reason).toContain("doc_not_public");
    expect(result.reason).toContain("Anyone with the link");
    // Nothing reached the table: a failed read must not touch the live index.
    expect(admin.from).not.toHaveBeenCalled();
  });

  // An export that momentarily returns nothing must not be mistaken for "the
  // owner emptied the doc" — pruning on that reading wipes the knowledge base.
  it("leaves the index untouched when the export comes back empty", async () => {
    vi.stubEnv("ADVISOR_KNOWLEDGE_DOC_URL", DOC_URL);
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse("   \n\n  "));
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncKnowledgeDoc(admin as unknown as SupabaseClient);

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("empty_doc");
    expect(admin.from).not.toHaveBeenCalled();
    // No embeddings were bought for a document that turned out to be empty.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("upserts every chunk and only then prunes the tail of the previous sync", async () => {
    const paragraph = Array.from({ length: 125 }, () => "refunds").join(" ");
    const docText = `${paragraph}\n\n${paragraph}`;
    const expected = chunkText(docText);
    expect(expected).toHaveLength(2); // guards the fixture, not the code

    vi.stubEnv("ADVISOR_KNOWLEDGE_DOC_URL", DOC_URL);
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("openai.com")
          ? // Deliberately out of order: OpenAI returns an `index` per input and
            // the code must pair by it. Array order would pair chunk 0 with
            // chunk 1's vector and nothing would ever complain.
            fakeJsonResponse({
              data: [
                { index: 1, embedding: [0.2] },
                { index: 0, embedding: [0.1] },
              ],
            })
          : fakeResponse(`﻿${docText}`),
      ),
    );

    const db = recordingAdmin();
    const result = await syncKnowledgeDoc(db.client);

    expect(result).toEqual({ ok: true, chunks: 2, skipped: false });
    expect(db.from).toHaveBeenCalledWith("advisor_documents");

    const [rows, options] = db.upsert.mock.calls[0] as unknown as [
      { source_id: string; chunk_index: number; content: string; embedding: number[] }[],
      { onConflict: string },
    ];
    expect(options).toEqual({ onConflict: "source_id,chunk_index" });
    expect(rows.map((r) => r.chunk_index)).toEqual([0, 1]);
    expect(rows.map((r) => r.embedding)).toEqual([[0.1], [0.2]]);
    // The Doc id, not the URL: the key must not move when the URL gains a param.
    expect(rows.map((r) => r.source_id)).toEqual(["DOC123", "DOC123"]);
    // Stored content starts at the first real word — no BOM glued to it.
    expect(rows[0].content.startsWith("refunds")).toBe(true);

    // The prune is scoped to this source and to indices past the new tail; a
    // missing filter here would delete another document's chunks.
    expect(db.eq).toHaveBeenCalledWith("source_id", "DOC123");
    expect(db.gte).toHaveBeenCalledWith("chunk_index", 2);
    expect(db.calls).toEqual(["upsert", "delete"]);
  });
});
