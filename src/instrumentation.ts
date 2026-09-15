import type { Instrumentation } from "next";

import { notifyOps } from "@/lib/ops/alert";

// Um 500 no checkout, numa aula ou no login so aparecia no log do Vercel, que
// ninguem le. Este gancho do Next (onRequestError) recebe todo erro de
// requisicao no servidor e avisa o Telegram de ops pelo notifyOps, que ja
// segura repeticoes por instancia, roda depois da resposta e nunca lanca.

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

// Trava de reentrada: um erro disparado de dentro do aviso nao pode voltar
// aqui e avisar de novo. (O throttle do notifyOps ja segura repeticoes do
// mesmo evento por 5 minutos; isto cobre a chamada sincrona.)
let reporting = false;

export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  if (reporting || isExpected(error)) {
    return;
  }

  reporting = true;
  try {
    // O log do Vercel continua com o erro inteiro; so o aviso sai enxuto.
    console.error("[app.server_error]", context.routeType, context.routePath, error);

    const message = error instanceof Error ? error.message : String(error);
    notifyOps({
      event: "app.server_error",
      // alert.ts so aceita "warn" | "critical"; um 500 inesperado e falha real.
      severity: "critical",
      summary: "A server request failed with an unexpected error (HTTP 500).",
      // So o padrao da rota, o tipo, o metodo, o nome do erro e uma impressao
      // digital. Nunca a URL com query, cabecalhos, cookies, corpo, ids,
      // e-mails ou a mensagem inteira.
      context: {
        route: context.routePath.split("?")[0],
        routeType: context.routeType,
        method: request.method,
        errorName: error instanceof Error ? error.name : typeof error,
        fingerprint: digestOf(error) ?? shortHash(message),
      },
    });
  } catch {
    // notifyOps ja nao lanca; isto garante que o aviso nunca vire um segundo
    // erro nem segure a resposta.
  } finally {
    reporting = false;
  }
};
