import type { Instrumentation } from "next";

import { keepAliveUntil, sendOpsAlert } from "@/lib/ops/alert";

// Um erro no checkout, numa aula ou no login so aparecia no log do Vercel, que
// ninguem le. Este gancho do Next (onRequestError) recebe todo erro de
// requisicao no servidor e avisa o Telegram de ops.
//
// Duas formas de o Next chamar este gancho, e o envio tem de sobreviver a ambas:
//  - AGUARDADO: no catch do route handler, no catch externo da pagina e no
//    proxy, depois de sair do escopo da requisicao. Ali o after() lanca; o
//    Next espera o gancho, entao o `await` segura a invocacao ate o aviso sair.
//  - DESCARTADO: nos erros de renderizacao (RSC/SSR) e nas server actions o
//    gancho entra no onError do React, que chama e JOGA FORA a promessa. Ali o
//    `await` sozinho vira um fetch que ninguem espera, e a instancia congela
//    antes de ele sair.
// Por isso o envio comeca uma vez so, a MESMA promessa vai para o after() (ou
// para o waitUntil da plataforma, fora do escopo) e so entao e aguardada.
// sendOpsAlert tem teto de 4 s e nunca lanca.
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
// evento: um erro inofensivo e recorrente numa rota nao pode esconder o do
// checkout. A vaga e reservada antes do envio (um erro que volte a este gancho
// pela mesma rota para aqui) e encurtada para 60 s se o relay nao confirmou.
const THROTTLE_MS = 5 * 60 * 1000;
const LOST_SEND_RETRY_MS = 60 * 1000;
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
  const key = `app.server_error:${route}`;
  const reservedAt = Date.now();
  if (!shouldSend(key, reservedAt)) {
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  const pending = sendOpsAlert({
    event: "app.server_error",
    // alert.ts so aceita "warn" | "critical". Sem status no texto: um erro
    // pego por error.tsx, ou lancado num Suspense depois do shell, sai com 200.
    severity: "critical",
    summary: `Server error on ${route} (${context.routeType}).`,
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

  // A mesma promessa vive ate o relay responder mesmo quando ninguem aguarda
  // este gancho (onError do React). keepAliveUntil nunca lanca.
  keepAliveUntil(pending);

  const delivered = await pending;
  // Envio que o relay nao confirmou nao pode calar a rota por 5 minutos, mas
  // tambem nao pode liberar a rota na hora: um relay que entrega no Telegram e
  // demora mais de 4 s para responder da "falha" com a mensagem entregue, e uma
  // rota quebrada avisaria a cada poucos segundos. A vaga encurta para 60 s,
  // se nenhum envio mais novo a pegou: no pior caso, 1 aviso por minuto por
  // rota por instancia, e um aviso perdido volta em ate um minuto.
  if (!delivered && lastSentAt.get(key) === reservedAt) {
    lastSentAt.set(key, Date.now() - THROTTLE_MS + LOST_SEND_RETRY_MS);
  }
};
