// Minimal OpenAI client for the teacher's AI tools: transcription
// (captions) and text with JSON output (translation, quiz, suggestions). Same pattern
// as kimi.ts: one fetch and a JSON body, with no SDK to keep in sync.
//
// SECURITY: OPENAI_API_KEY only on the server (no NEXT_PUBLIC), travels in the header
// and never in an error message. OpenAI returns the rejected key in the error
// text ("Incorrect API key provided: sk-..."), so the text is cleaned before
// it becomes an exception, which ends up in a log.

// Transcription: whisper-1 is the cheapest model that returns TIMING. The
// gpt-4o-*-transcribe models accept only response_format "json" (text without times),
// so they do not produce captions. Official price: US$ 0.006 per minute.
export const TRANSCRIBE_MODEL = "whisper-1";
// Text: cheap, no reasoning (answers in seconds) and with schema output.
export const TEXT_MODEL = "gpt-4.1-mini";

const API = "https://api.openai.com/v1";

export class OpenAIConfigError extends Error {
  readonly code = "ai_not_configured";
  constructor() {
    super("OPENAI_API_KEY is not configured.");
    this.name = "OpenAIConfigError";
  }
}

/**
 * `no_credit`: the OpenAI account is out of balance (429 with
 * insufficient_quota/credit_balance_exhausted). Retrying does not help; it needs a top-up.
 * `upstream_error`: an OpenAI failure, may pass. `bad_reply`: the reply came
 * outside the requested format.
 */
export class OpenAIError extends Error {
  readonly code: "no_credit" | "upstream_error" | "bad_reply";
  constructor(code: OpenAIError["code"], message: string) {
    super(message);
    this.name = "OpenAIError";
    this.code = code;
  }
}

function apiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new OpenAIConfigError();
  return key;
}

async function failure(response: Response, key: string): Promise<OpenAIError> {
  const detail = (await response.text().catch(() => ""))
    .split(key).join("[redacted]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-***")
    .slice(0, 200);
  const noCredit = response.status === 429 && /insufficient_quota|credit_balance/.test(detail);
  return new OpenAIError(noCredit ? "no_credit" : "upstream_error", `openai_${response.status}: ${detail}`);
}

/** Transcribes an audio chunk (up to 25 MB) and returns Whisper's WebVTT. */
export async function transcribeToVtt(opts: {
  audio: Uint8Array<ArrayBuffer>;
  fileName: string;
  language: string;
  signal?: AbortSignal;
}): Promise<string> {
  const key = apiKey();
  const form = new FormData();
  form.append("file", new Blob([opts.audio], { type: "audio/ogg" }), opts.fileName);
  form.append("model", TRANSCRIBE_MODEL);
  form.append("response_format", "vtt");
  form.append("language", opts.language);

  const response = await fetch(`${API}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: opts.signal,
  });
  if (!response.ok) throw await failure(response, key);
  return response.text();
}

/**
 * Asks the text model for an answer that follows `schema` (structured outputs,
 * strict). Returns the object already parsed; the caller validates the content.
 */
export async function askJson<T>(opts: {
  system: string;
  user: string;
  schemaName: string;
  schema: Record<string, unknown>;
  signal?: AbortSignal;
}): Promise<T> {
  const key = apiKey();
  const response = await fetch(`${API}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: TEXT_MODEL,
      temperature: 0.3,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: opts.schemaName, strict: true, schema: opts.schema },
      },
    }),
    signal: opts.signal,
  });
  if (!response.ok) throw await failure(response, key);

  const payload = (await response.json().catch(() => null)) as {
    choices?: { message?: { content?: string | null; refusal?: string | null } }[];
  } | null;
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) throw new OpenAIError("bad_reply", "openai_empty_reply");
  try {
    return JSON.parse(content) as T;
  } catch {
    throw new OpenAIError("bad_reply", "openai_reply_not_json");
  }
}
