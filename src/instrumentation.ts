import type { Instrumentation } from "next";

import { sendOpsAlert } from "@/lib/ops/alert";

// Um 500 no checkout, numa aula ou no login so aparecia no log do Vercel, que
// ninguem le. Este gancho do Next (onRequestError) recebe todo erro de
// requisicao no servidor e avisa o Telegram de ops.
//
// AGUARDA o envio de proposito. Num 500 de route handler o Next chama este
// gancho depois de sair de todo escopo de requisicao: ali o after() do
// notifyOps lanca, e o fetch sem await morre quando a invocacao termina (o
// mesmo buraco que alert.ts descreve). O Next espera este gancho antes de
// seguir, entao aguardar o sendOpsAlert (4 s de teto, nunca lanca) garante que
// o aviso sai. Custo: ate 4 s a mais numa resposta que ja falhou.
//
// O Next ja registra o erro inteiro no log antes de chamar o gancho, entao
// aqui nao ha console.error.

// Erros de fluxo do Next, nao falha: notFound()/forbidden()/unauthorized()
// e redirect() viajam como excecao com `digest`.
const CONTROL_FLOW_DIGESTS = ["NEXT_REDIRECT", "NEXT_HTTP_ERROR_FALLBACK", "NEXT_NOT_FOUND"];

function digestOf(error: unknown): string | null {
  if (typeof error === "object" && error !== null && "digest" in error) {
    const { digest } = error as { digest: unknown };
    return typeof digest === "string" ? digest : null;
  }
  return null;
}

function isExpected(error: unknown): boolean {
  const digest = digestOf(error);
  if (digest && CONTROL_FLOW_DIGESTS.some((code) => digest.startsWith(code))) {
    return true;
  }
  // Cliente que fechou a conexao no meio: nao e defeito da plataforma.
  return (
    error instanceof Error
    && (error.name === "AbortError" || (error as { code?: unknown }).code === "ECONNRESET")
  );
}

// FNV-1a de 32 bits: agrupa erros iguais sem mandar o texto (a mensagem pode
// carregar dado pessoal) e sem node:crypto, que o runtime edge nao tem.
function shortHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

// Um aviso por rota a cada 5 minutos, por instancia. Por ROTA, e nao pelo
// evento: um 500 inofensivo e recorrente numa rota nao pode esconder o 500 do
// checkout. A chave e gravada antes do envio, entao um erro que volte a este
// gancho pela mesma rota tambem para aqui.
const THROTTLE_MS = 5 * 60 * 1000;
const MAX_ROUTES = 200;
const lastSentAt = new Map<string, number>();

function shouldSend(key: string, now: number): boolean {
  const previous = lastSentAt.get(key);
  if (previous !== undefined && now - previous < THROTTLE_MS) {
    return false;
  }
  // delete + set deixa o Map em ordem de uso: o primeiro e o mais antigo.
  lastSentAt.delete(key);
  lastSentAt.set(key, now);
  if (lastSentAt.size > MAX_ROUTES) {
    const oldest = lastSentAt.keys().next().value;
    if (oldest !== undefined) {
      lastSentAt.delete(oldest);
    }
  }
  return true;
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (isExpected(error)) {
    return;
  }

  const route = context.routePath.split("?")[0];
  if (!shouldSend(`app.server_error:${route}`, Date.now())) {
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  // sendOpsAlert nunca lanca e tem teto de 4 s: o aviso nao vira um segundo
  // erro nem prende a resposta alem disso.
  await sendOpsAlert({
    event: "app.server_error",
    // alert.ts so aceita "warn" | "critical"; um 500 inesperado e falha real.
    severity: "critical",
    summary: "A server request failed with an unexpected error (HTTP 500).",
    // So o padrao da rota, o tipo, o metodo, o nome do erro e uma impressao
    // digital. Nunca a URL com query, cabecalhos, cookies, corpo, ids,
    // e-mails ou a mensagem inteira.
    context: {
      route,
      routeType: context.routeType,
      method: request.method,
      errorName: error instanceof Error ? error.name : typeof error,
      fingerprint: digestOf(error) ?? shortHash(message),
    },
  });
};
