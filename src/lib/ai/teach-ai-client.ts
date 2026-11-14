// Chamada do estúdio à rota /api/teach/ai. Uma função para as três telas
// (legenda, quiz, sugestões). O erro vira texto pelo `code` da rota, no idioma
// da tela; código desconhecido cai no genérico.
export type TeachAiResult = { ok: boolean; status: number; body: Record<string, unknown> & { error?: string; code?: string } };

const KNOWN_ERRORS = new Set([
  "forbidden", "lesson_not_found", "unavailable", "no_video", "video_processing", "too_long", "monthly_limit",
  "ai_unavailable", "audio_unavailable", "no_speech", "bad_vtt", "no_caption", "stale_caption", "no_transcript",
  "nothing_usable", "bad_quiz", "activation_required",
]);

export function teachAiErrorText(result: TeachAiResult, t: (key: string) => string): string {
  const code = typeof result.body.code === "string" ? result.body.code : "";
  if (KNOWN_ERRORS.has(code)) return t(`creatorEditor.lesson.ai.errors.${code}`);
  if (result.status === 429) return t("creatorEditor.lesson.ai.errors.rate_limited");
  return t("creatorEditor.lesson.ai.errorGeneric");
}

export async function callTeachAi(payload: Record<string, unknown>): Promise<TeachAiResult> {
  try {
    const response = await fetch("/api/teach/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, body };
  } catch {
    return { ok: false, status: 0, body: {} };
  }
}

export async function loadTeachAi(params: Record<string, string>): Promise<TeachAiResult> {
  try {
    const response = await fetch(`/api/teach/ai?${new URLSearchParams(params)}`, { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, body };
  } catch {
    return { ok: false, status: 0, body: {} };
  }
}
