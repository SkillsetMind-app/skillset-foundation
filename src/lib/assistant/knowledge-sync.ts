import type { SupabaseClient } from "@supabase/supabase-js";

// Mirror of the platform knowledge base — a Google Doc the owner edits by hand —
// into advisor_documents, with embeddings so the advisor can retrieve from it.
//
// Why this exists: buildAssistantKnowledge() is compiled from files in the repo,
// so correcting one wrong answer costs a commit and a deploy. The long-form help
// corpus therefore lives in a Doc the owner can fix at 9pm, and this job is what
// makes that edit reachable by the model.
//
// ACCESS TRADE-OFF (decided, not accidental): the Doc is read through its public
// text-export URL, which requires "anyone with the link can view". Anyone holding
// the link can read it. That is acceptable because this is the same help content
// already published on the site — never student, teacher or financial data. The
// alternative is a Google service account, i.e. long-lived Google credentials on
// the server, which is a real cost we are refusing to pay for public help text.
// Upgrade path if the corpus ever turns private: service account + Docs API.
//
// SECURITY: this takes the service-role client on purpose — advisor_documents is
// a server-write-only table like payments and payout_ledger. Nothing here reads
// user data, so there is no RLS scoping to preserve.

// ~1500 chars is about 375 tokens: large enough to hold a whole FAQ answer (the
// unit the advisor actually needs to quote — half an answer retrieves as a
// confident half-truth), small enough that the five chunks a query pulls back
// still leave the model room to reason. The 150-char overlap is roughly one
// sentence: a sentence that lands exactly on a seam then survives whole in one
// of the two neighbouring chunks instead of being split across both.
const DEFAULT_MAX_CHARS = 1_500;
const OVERLAP_CHARS = 150;

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_BATCH = 100;
const UPSERT_BATCH = 50; // ~1MB of JSON per request: 50 rows x 1536 floats
const FETCH_TIMEOUT_MS = 30_000;

// The only failure that actually happens in production, so it gets a written
// answer instead of a stack trace: whoever is on call needs a checkbox, not logs.
const NOT_PUBLIC_REASON =
  'doc_not_public: Google returned a sign-in page instead of text. Open the doc, then Share > General access > "Anyone with the link" (Viewer), and check ADVISOR_KNOWLEDGE_DOC_URL ends with /export?format=txt.';

export type KnowledgeSyncResult = {
  ok: boolean;
  chunks: number;
  skipped: boolean;
  reason?: string;
};

/** Trailing slice of `text` that starts on a word boundary, at most `maxChars`. */
function tailAtWordBoundary(text: string, maxChars: number): string {
  if (maxChars <= 0) return "";
  if (text.length <= maxChars) return text;
  const tail = text.slice(text.length - maxChars);
  const firstSpace = tail.search(/\s/);
  // No whitespace at all means the tail sits inside one long token; carrying half
  // a word forward is worse than carrying nothing.
  return firstSpace === -1 ? "" : tail.slice(firstSpace + 1);
}

/** Split one oversized paragraph on word boundaries. */
function splitParagraph(paragraph: string, maxChars: number): string[] {
  const pieces: string[] = [];
  let current = "";

  for (const word of paragraph.split(/\s+/)) {
    if (word.length > maxChars) {
      // A single token longer than the limit (a pasted URL, a base64 blob) has no
      // word boundary to break on, so it gets hard-cut. Pathological input only.
      if (current) pieces.push(current);
      for (let i = 0; i < word.length; i += maxChars) pieces.push(word.slice(i, i + maxChars));
      current = "";
      continue;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
    } else {
      pieces.push(current);
      current = word;
    }
  }

  if (current) pieces.push(current);
  return pieces;
}

/**
 * Split help text into embeddable chunks, preferring paragraph boundaries and
 * never cutting a word in half. Consecutive chunks share up to OVERLAP_CHARS of
 * text so a sentence on a seam stays intact somewhere. Every returned chunk is
 * at most `maxChars` long, overlap included.
 */
export function chunkText(text: string, maxChars: number = DEFAULT_MAX_CHARS): string[] {
  const normalised = text.replace(/\r\n/g, "\n");

  // Blank lines are the preferred boundary, but they are not guaranteed: a Doc
  // whose paragraphs are separated by single newlines exports that way, and
  // splitting on /\n{2,}/ then returns the ENTIRE document as one paragraph.
  // It degrades silently — every heading gets glued into the body of the text
  // and the chunks stop lining up with ideas — so fall back to single newlines
  // when the blank-line split found no structure at all.
  let paragraphs = normalised
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  if (paragraphs.length <= 1 && normalised.includes("\n")) {
    paragraphs = normalised
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }

  const pieces = paragraphs.flatMap((paragraph) =>
    paragraph.length <= maxChars ? [paragraph] : splitParagraph(paragraph, maxChars),
  );

  const chunks: string[] = [];
  let current = "";

  for (const piece of pieces) {
    const candidate = current ? `${current}\n\n${piece}` : piece;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    chunks.push(current);
    // Budget the carry against what is left after the incoming piece, so the
    // overlap can never push a chunk past maxChars.
    const carry = tailAtWordBoundary(current, Math.min(OVERLAP_CHARS, maxChars - piece.length - 2));
    current = carry ? `${carry}\n\n${piece}` : piece;
  }

  if (current) chunks.push(current);
  return chunks;
}

/**
 * source_id is the Doc id rather than the URL, so adding a query parameter to
 * ADVISOR_KNOWLEDGE_DOC_URL does not orphan every row under a new key.
 *
 * The optional `e/` matches the published-to-web form
 * (/document/d/e/2PACX-.../pub?output=txt): without it the id reads as the
 * literal "e", and two published docs would then share one source_id and
 * overwrite each other's chunks. `[^/?#]` rather than `[^/]` because the id can
 * be the last path segment, with the query string directly attached.
 */
function docIdFromUrl(docUrl: string): string {
  return /\/document\/d\/(?:e\/)?([^/?#]+)/.exec(docUrl)?.[1] ?? docUrl;
}

async function fetchDocText(docUrl: string): Promise<string> {
  const response = await fetch(docUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  const body = await response.text();

  // A doc that was never shared publicly answers the export URL with Google's
  // sign-in page — HTML, and frequently HTTP 200, so status alone misses it.
  const contentType = response.headers.get("content-type") ?? "";
  const looksLikeHtml =
    contentType.includes("text/html") || /^\s*<(?:!doctype|html)/i.test(body.slice(0, 200));
  if (looksLikeHtml || response.status === 401 || response.status === 403) {
    throw new Error(NOT_PUBLIC_REASON);
  }
  if (!response.ok) {
    throw new Error(
      `fetch_failed_${response.status}: Google returned HTTP ${response.status} for the export URL.`,
    );
  }

  // The txt export is UTF-8 with a BOM; left in place it glues itself to the
  // first word of the first chunk.
  return body.charCodeAt(0) === 0xfeff ? body.slice(1) : body;
}

/**
 * Exported so retrieval embeds the QUESTION with the same model, the same error
 * handling and the same key-redaction as the corpus. Two vectors are only
 * comparable if they came from the same model, so a second copy of this call
 * elsewhere is a silent correctness bug waiting for someone to change one of
 * them.
 */
export async function embedChunks(chunks: string[], apiKey: string): Promise<number[][]> {
  const vectors: number[][] = [];

  // ponytail: serial batches, not parallel requests — a help doc is a handful of
  // batches and a serial loop cannot trip the rate limit. Parallelise only if the
  // corpus grows past a few thousand chunks.
  for (let start = 0; start < chunks.length; start += EMBEDDING_BATCH) {
    const batch = chunks.slice(start, start + EMBEDDING_BATCH);
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: batch }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      // OpenAI answers a bad key with "Incorrect API key provided: sk-…", i.e.
      // it echoes back the credential we sent. This string becomes the `reason`
      // a cron endpoint logs, so the key is scrubbed before it can travel any
      // further; the rest of the body is what makes the failure debuggable.
      const detail = (await response.text()).slice(0, 200).replace(/sk-[A-Za-z0-9_-]+/g, "sk-***");
      throw new Error(`embedding_failed_${response.status}: ${detail}`);
    }

    const payload = (await response.json()) as {
      data?: { index: number; embedding: number[] }[];
    };
    const data = payload.data ?? [];
    if (data.length !== batch.length) {
      throw new Error(
        `embedding_failed_incomplete: asked for ${batch.length} vectors, got ${data.length}.`,
      );
    }

    // Order by the returned index rather than trusting array order: a mismatch
    // here pairs a chunk with someone else's vector and stays silent forever.
    for (const item of [...data].sort((a, b) => a.index - b.index)) {
      vectors.push(item.embedding);
    }
  }

  return vectors;
}

async function writeChunks(
  admin: SupabaseClient,
  sourceId: string,
  chunks: string[],
  embeddings: number[][],
): Promise<void> {
  const now = new Date().toISOString();
  const rows = chunks.map((content, index) => ({
    source_id: sourceId,
    chunk_index: index,
    content,
    embedding: embeddings[index],
    // The embeddings API reports usage per request, not per input, so this is the
    // usual ~4 chars/token estimate. It exists for cost monitoring; retrieval
    // never reads it.
    token_count: Math.ceil(content.length / 4),
    updated_at: now,
  }));

  for (let start = 0; start < rows.length; start += UPSERT_BATCH) {
    const { error } = await admin
      .from("advisor_documents")
      .upsert(rows.slice(start, start + UPSERT_BATCH), { onConflict: "source_id,chunk_index" });
    if (error) throw new Error(`upsert_failed: ${error.message}`);
  }

  // The classic bug in this kind of sync: the doc shrinks from 40 chunks to 25,
  // chunks 25..39 are never touched by the upsert, and the advisor keeps quoting
  // paragraphs the owner deleted. Prune everything past the new tail — and do it
  // AFTER the upsert, so a failed embed leaves yesterday's copy intact instead of
  // an empty knowledge base.
  const { error } = await admin
    .from("advisor_documents")
    .delete()
    .eq("source_id", sourceId)
    .gte("chunk_index", chunks.length);
  if (error) throw new Error(`prune_failed: ${error.message}`);
}

/**
 * Pull the knowledge doc and refresh advisor_documents. Never throws: this runs
 * on a schedule, and a sync that cannot run is not an incident — the advisor
 * keeps answering from whatever was indexed last.
 */
export async function syncKnowledgeDoc(admin: SupabaseClient): Promise<KnowledgeSyncResult> {
  const docUrl = process.env.ADVISOR_KNOWLEDGE_DOC_URL;
  const apiKey = process.env.OPENAI_API_KEY;

  // Missing config is a not-yet-set-up state, not a failure. The cron ticks
  // regardless of whether anyone has written the doc yet.
  if (!docUrl) return { ok: false, chunks: 0, skipped: true, reason: "not_configured" };
  if (!apiKey) return { ok: false, chunks: 0, skipped: true, reason: "openai_key_missing" };

  try {
    const chunks = chunkText(await fetchDocText(docUrl));
    if (chunks.length === 0) {
      // An empty read must never prune a healthy index: an export that briefly
      // returns nothing would otherwise delete the entire knowledge base.
      throw new Error("empty_doc: the export returned no text; the existing index was left alone.");
    }

    const sourceId = docIdFromUrl(docUrl);
    await writeChunks(admin, sourceId, chunks, await embedChunks(chunks, apiKey));
    return { ok: true, chunks: chunks.length, skipped: false };
  } catch (error) {
    return {
      ok: false,
      chunks: 0,
      skipped: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
