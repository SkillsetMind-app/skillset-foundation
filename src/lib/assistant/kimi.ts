// Minimal Moonshot (Kimi) chat client for the STUDIO ADVISOR.
//
// Why this exists: the advisor reaches its model through an n8n webhook, which
// puts the prompt, the model choice and the failure behaviour outside this repo
// and outside CI. Calling Moonshot directly brings the model contract back under
// version control. The API speaks the OpenAI wire format, so a fetch and a JSON
// body are the entire client — no SDK, nothing to keep in sync with a vendor.
//
// SECURITY: KIMI_API_KEY is server-only (no NEXT_PUBLIC prefix), so Next never
// inlines it into a client bundle. It travels as a Bearer header and never
// reaches a thrown message — upstream error text is surfaced because it is what
// makes a 400 debuggable, the credential is not.
// ponytail: no streaming, no retries. The advisor renders one reply at a time,
// and the caller already owns the timeout via `signal`; add streaming only when
// the UI can actually show partial text.

const KIMI_ENDPOINT = "https://api.moonshot.ai/v1/chat/completions";
const KIMI_MODEL = "kimi-k3";

// kimi-k3 is a reasoning model: it spends tokens THINKING before it writes, and
// max_tokens caps thinking plus answer together. Measured on this account:
// max_tokens=12 came back with content "" and usage.reasoning_tokens=9 — the
// budget was eaten reasoning, nothing was left to answer with, and the API
// reported HTTP 200. A tight ceiling here does not fail loudly, it fails blank.
// 8192 leaves room for several thousand reasoning tokens and still a full,
// multi-paragraph piece of advice on top of them.
const MAX_TOKENS = 8192;

// NO temperature is sent, and that is not an oversight — kimi-k3 rejects the
// parameter outright. Measured against the live endpoint:
//   temperature: 0.2  ->  HTTP 400
//   {"error":{"message":"invalid temperature: only 1 is allowed for this model"}}
// Every advisor call would have failed. Mocked tests cannot catch this, because
// a fake fetch never argues about the body — which is why sendsNoTemperature
// below asserts on the request instead of on the reply.
// Determinism has to come from the prompt, not from a sampling knob: the system
// prompt tells the model to answer only from supplied context.

export type KimiMessage = { role: "system" | "user" | "assistant"; content: string };

/**
 * KIMI_API_KEY is not set. Callers catch this to render the same calm "being set
 * up" state the advisor already shows for a missing webhook, rather than a 500 —
 * an unconfigured model is a deployment gap, not a request that went wrong.
 */
export class KimiConfigError extends Error {
  readonly code = "kimi_not_configured";
  constructor() {
    super("KIMI_API_KEY is not configured.");
    this.name = "KimiConfigError";
  }
}

/**
 * The call reached Moonshot but produced no usable text. `code` separates the
 * three cases, because they need different answers: `upstream_error` may be
 * transient, `reasoning_budget_exhausted` means MAX_TOKENS is too low for this
 * class of question and retrying identically will fail identically, and
 * `empty_reply` is the model declining to speak at all.
 */
export class KimiError extends Error {
  readonly code: "upstream_error" | "reasoning_budget_exhausted" | "empty_reply";

  constructor(code: KimiError["code"], message: string) {
    super(message);
    this.name = "KimiError";
    this.code = code;
  }
}

type KimiResponse = {
  choices?:
    | { finish_reason?: string | null; message?: { content?: unknown } | null }[]
    | null;
  usage?: {
    reasoning_tokens?: number | null;
    completion_tokens_details?: { reasoning_tokens?: number | null } | null;
  } | null;
};

// Moonshot reports an error as { error: { message } }, but a gateway in front of
// it may return { error: "..." } or no JSON at all. Read all three shapes so the
// thrown message carries the real cause instead of a bare status code.
function upstreamMessage(payload: unknown): string | null {
  const err = (payload as { error?: unknown } | null)?.error;
  if (typeof err === "string") return err;
  const message = (err as { message?: unknown } | null | undefined)?.message;
  return typeof message === "string" ? message : null;
}

// Upstream text is quoted verbatim into a thrown message that ends up in server
// logs, and OpenAI-compatible auth errors habitually quote back the credential
// they rejected ("Incorrect API key provided: sk-..."). Strip the key we sent
// before it can be logged, and cap the length the way the sibling sync job caps
// its own upstream detail.
function safeDetail(detail: string, apiKey: string): string {
  return detail.split(apiKey).join("[redacted]").slice(0, 200);
}

// OpenAI-compatible servers disagree on where the reasoning count lives: at the
// top of `usage` on some, nested under completion_tokens_details on others.
function reasoningTokensOf(payload: KimiResponse | null): number {
  const usage = payload?.usage;
  return (
    usage?.reasoning_tokens ?? usage?.completion_tokens_details?.reasoning_tokens ?? 0
  );
}

/**
 * Sends a conversation to kimi-k3 and returns the reply text.
 *
 * Throws KimiConfigError when the key is missing, and KimiError when the model
 * answers with nothing usable — never an empty string, because a caller that
 * renders "" shows the teacher a silent, successful-looking failure.
 */
export async function askKimi(opts: {
  messages: KimiMessage[];
  signal?: AbortSignal;
}): Promise<string> {
  const apiKey = process.env.KIMI_API_KEY;
  if (!apiKey) throw new KimiConfigError();

  const response = await fetch(KIMI_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: KIMI_MODEL,
      messages: opts.messages,
      max_tokens: MAX_TOKENS,
    }),
    // The caller owns the deadline (the route already budgets one for the whole
    // request); a second timer here would silently shorten it.
    signal: opts.signal,
  });

  const payload = (await response.json().catch(() => null)) as KimiResponse | null;

  if (!response.ok) {
    // `||`, not `??`: statusText is "" (not null) whenever the server sends no
    // reason phrase, which is always the case over HTTP/2.
    const detail = upstreamMessage(payload) || response.statusText || "no detail returned";
    throw new KimiError(
      "upstream_error",
      `Kimi request failed (${response.status}): ${safeDetail(detail, apiKey)}`,
    );
  }

  // Typed as unknown because it is unvalidated JSON: an OpenAI-compatible server
  // that answers with content parts instead of a string would otherwise crash on
  // .trim() with a raw TypeError, escaping the KimiError contract callers catch.
  const raw = payload?.choices?.[0]?.message?.content;
  const content = typeof raw === "string" ? raw : "";
  if (content.trim().length > 0) return content;

  // An empty answer from a reasoning model has two very different causes, and
  // the message has to name the right one: blaming the token budget for a model
  // that simply declined to speak sends the next person to raise a number that
  // was not the problem. finish_reason "length" is the API stating outright that
  // the ceiling ended the turn; reasoning_tokens only proves the model thought
  // first, which is equally true of one that thought and then declined. Trust
  // the explicit signal, and fall back to the count only when it is missing.
  const finishReason = payload?.choices?.[0]?.finish_reason ?? null;
  const reasoningTokens = reasoningTokensOf(payload);
  if (finishReason === "length" || (finishReason === null && reasoningTokens > 0)) {
    const spent = reasoningTokens > 0 ? ` (${reasoningTokens} reasoning tokens)` : "";
    throw new KimiError(
      "reasoning_budget_exhausted",
      `Kimi used its ${MAX_TOKENS}-token budget${spent} and had none left to answer with. Raise MAX_TOKENS or ask a narrower question.`,
    );
  }
  throw new KimiError("empty_reply", "Kimi returned an empty reply.");
}
