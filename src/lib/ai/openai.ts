// Cliente mínimo da OpenAI para as ferramentas de IA do professor: transcrição
// (legenda) e texto com saída em JSON (tradução, quiz, sugestões). Mesmo padrão
// do kimi.ts: um fetch e um corpo JSON, sem SDK para manter sincronizado.
//
// SEGURANÇA: OPENAI_API_KEY só no servidor (sem NEXT_PUBLIC), viaja no cabeçalho
// e nunca numa mensagem de erro. A OpenAI devolve a chave recusada no texto do
// erro ("Incorrect API key provided: sk-..."), então o texto é limpo antes de
// virar exceção, que acaba em log.

// Transcrição: whisper-1 é o modelo mais barato que devolve TEMPO. Os
// gpt-4o-*-transcribe aceitam só response_format "json" (texto sem tempos),
// então não geram legenda. Preço oficial: US$ 0,006 por minuto.
export const TRANSCRIBE_MODEL = "whisper-1";
// Texto: barato, sem raciocínio (responde em segundos) e com saída por esquema.
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
 * `no_credit`: a conta da OpenAI está sem saldo (429 com
 * insufficient_quota/credit_balance_exhausted). Repetir não adianta; é recarga.
 * `upstream_error`: falha da OpenAI, pode passar. `bad_reply`: a resposta veio
 * fora do formato pedido.
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

/** Transcreve um pedaço de áudio (até 25 MB) e devolve o WebVTT do Whisper. */
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
 * Pede ao modelo de texto uma resposta que siga `schema` (structured outputs,
 * strict). Devolve o objeto já lido; quem chama valida o conteúdo.
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
