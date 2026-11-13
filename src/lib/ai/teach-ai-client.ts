// Chamada do estúdio à rota /api/teach/ai. Uma função para as três telas
// (legenda, quiz, sugestões): o erro vem com o texto da rota, que já é para o
// professor ler; sem texto, quem chama mostra o genérico.
export type TeachAiResult = { ok: boolean; status: number; body: Record<string, unknown> & { error?: string } };

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
