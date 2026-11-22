"use client";

import { useEffect } from "react";
import Link from "next/link";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { captureException } from "@/lib/posthog/client";

/**
 * Cartão de erro de uma ÁREA (/teach, /learn). Sem ele, uma página do estúdio
 * que quebrava caía no erro da raiz, cujo "Go home" leva ao site público: o
 * professor saía do produto para se recuperar de um erro dentro dele. Aqui o
 * botão volta ao início da própria área. Mesmo desenho de `app/error.tsx`.
 */
export function RouteError({
  error,
  reset,
  homeHref,
  boundary,
}: {
  error: Error & { digest?: string };
  reset: () => void;
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
    <main className="flex min-h-[70svh] items-center justify-center px-6 py-10">
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
          <button type="button" onClick={reset} className="button-solid px-4 py-2.5 text-sm">
            {t("appErrors.retry")}
          </button>
          <Link href={homeHref} className="button-outline px-4 py-2.5 text-sm">
            {t("appErrors.home")}
          </Link>
        </div>
      </div>
    </main>
  );
}
