"use client";

import { useEffect } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { captureException } from "@/lib/posthog/client";

export type RouteErrorProps = {
  error: Error & { digest?: string };
  /** Só limpa o erro e redesenha com o que o navegador já tem. */
  reset: () => void;
  /** Recarrega os dados da rota e então limpa o erro (Next 16.4+). */
  retry?: () => void;
};

/**
 * Cartão de erro de uma ÁREA (/teach, /learn). Sem ele, uma página do estúdio
 * que quebrava caía no erro da raiz, cujo "Go home" leva ao site público: o
 * professor saía do produto para se recuperar de um erro dentro dele. Aqui o
 * botão volta ao início da própria área. Mesmo desenho de `app/error.tsx`.
 *
 * Dois cuidados para os botões funcionarem de verdade:
 * - "Try again" usa `retry`, que busca os dados de novo. Só `reset` redesenha
 *   com o mesmo resultado do servidor, e o erro volta igual.
 * - "Go home" é um <a> comum, com recarga completa. A fronteira de erro só se
 *   desfaz quando o endereço muda; com <Link>, quem já está em /teach
 *   clicaria e nada aconteceria.
 */
export function RouteError({
  error,
  reset,
  retry,
  homeHref,
  boundary,
}: RouteErrorProps & {
  /** Início da área (ex.: "/teach"). */
  homeHref: string;
  /** Nome que identifica a área no registro do erro. */
  boundary: string;
}) {
  const { t } = useTranslation();
  useEffect(() => {
    captureException(error, { boundary, digest: error.digest });
  }, [boundary, error]);

  return (
    <main className="flex min-h-svh items-center justify-center px-6 py-10">
      <div className="surface-card max-w-2xl rounded-lg p-8 text-center sm:p-10">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--color-primary)]">
          {t("appErrors.eyebrow")}
        </p>
        <h1 className="display-title mt-4 text-4xl text-[var(--color-ink)] sm:text-5xl">
          {t("appErrors.pageTitle")}
        </h1>
        <p className="mt-4 text-sm leading-7 text-[var(--color-ink-soft)]">
          {t("appErrors.pageBody")}
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <button type="button" onClick={retry ?? reset} className="button-solid px-4 py-2.5 text-sm">
            {t("appErrors.retry")}
          </button>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- recarga completa de propósito: a fronteira de erro só se desfaz quando o endereço muda, e <Link> para a mesma página não mudaria nada */}
          <a href={homeHref} className="button-outline px-4 py-2.5 text-sm">
            {t("appErrors.home")}
          </a>
        </div>
      </div>
    </main>
  );
}
