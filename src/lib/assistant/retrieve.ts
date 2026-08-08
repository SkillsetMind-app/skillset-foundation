import type { SupabaseClient } from "@supabase/supabase-js";

import { embedChunks } from "./knowledge-sync";

// Retrieval half of the advisor's knowledge base: turn the teacher's question
// into a vector and pull back only the passages that are actually about it.
//
// Why this exists alongside buildAssistantKnowledge(): that corpus is compiled
// from the repo and shipped whole on every request, which is correct while it
// stays around 10KB. The Doc-backed corpus has no such ceiling — it is meant to
// grow — so it gets searched instead of stuffed.

// Cosine similarity floor. Below this a passage is not "the weakest of five
// good answers", it is a passage about something else that happened to be the
// least unrelated thing in the table. Passing those to the model is how a
// retrieval layer manufactures a hallucination: the prompt presents them as
// knowledge and the model dutifully builds an answer on top.
// 0.25 is deliberately permissive — text-embedding-3-small scores a genuinely
// on-topic paragraph well above it, while an unrelated one lands under. Raise it
// if the advisor starts quoting tangents; lower it if it starts saying "I don't
// have that information" about things the Doc plainly covers.
const MATCH_THRESHOLD = 0.25;

// Five passages at ~1500 chars is ~7.5KB, on top of the ~10KB static corpus and
// the teacher snapshot. Comfortably inside the context window, and past this
// the extra passages are noise competing with the good ones for attention.
const MATCH_COUNT = 5;

type MatchRow = { content: string; similarity: number };

/**
 * Passages from the platform knowledge Doc that are relevant to `question`.
 *
 * Returns [] whenever retrieval cannot help — no key, no corpus indexed yet,
 * a failing query, or simply nothing above the relevance floor. That empty case
 * is a feature, not a degradation: the caller's prompt tells the model to say it
 * does not know when this block is empty, which is the whole anti-hallucination
 * contract. Never throws — a broken search must not take the chat down with it.
 */
export async function retrieveKnowledge(
  supabase: SupabaseClient,
  question: string,
): Promise<string[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || question.trim().length === 0) return [];

  try {
    // Same function the sync job uses, so the question and the corpus are
    // embedded by the same model. Vectors from different models are not
    // comparable, and the failure is silent — every similarity just comes back
    // meaningless rather than erroring.
    const [embedding] = await embedChunks([question], apiKey);
    if (!embedding) return [];

    const { data, error } = await supabase.rpc("match_advisor_documents", {
      query_embedding: embedding,
      match_threshold: MATCH_THRESHOLD,
      match_count: MATCH_COUNT,
    });
    if (error) return [];

    return ((data ?? []) as MatchRow[]).map((row) => row.content);
  } catch {
    return [];
  }
}

/** Render retrieved passages for the prompt, or "" when nothing was relevant. */
export function formatKnowledge(passages: string[]): string {
  if (passages.length === 0) return "";
  return [
    "# Platform knowledge base (retrieved for this question — treat as authoritative)",
    ...passages.map((passage) => `---\n${passage}`),
  ].join("\n\n");
}
