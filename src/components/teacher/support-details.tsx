"use client";

import type { ReactNode } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";

/**
 * O que so o suporte precisa (o codigo do erro, ids, slug) fica recolhido num
 * "Details for support": a pessoa le a frase do que fazer, e o resto continua
 * na pagina, selecionavel, para quem for colar num chamado. Antes era
 * "Reference: HTTP 409" na cara de quem tentava pagar, e "Course ID ... Slug
 * ..." em texto cru no detalhe da venda.
 */
export function SupportDetails({
  code,
  className = "",
  children,
}: {
  /** Status da resposta que falhou: sai como "Error code: 409". */
  code?: number;
  className?: string;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <details className={`text-xs leading-5 text-[var(--color-ink-soft)] ${className}`}>
      <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-[var(--color-primary)]">
        {t("appErrors.supportDetails")}
      </summary>
      <div className="grid gap-1 pb-1">
        {code ? (
          <p className="num select-all">
            {t("appErrors.errorCode").replace("{code}", () => String(code))}
          </p>
        ) : null}
        {children}
      </div>
    </details>
  );
}
