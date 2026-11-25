"use client";

import type { ReactNode } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";

/**
 * What only support needs (the error code, ids, slug) stays collapsed in a
 * "Details for support": the person reads the sentence about what to do, and the rest stays
 * on the page, selectable, for whoever pastes it into a ticket. Before it was
 * "Reference: HTTP 409" in the face of someone trying to pay, and "Course ID ... Slug
 * ..." in raw text in the sale detail.
 */
export function SupportDetails({
  code,
  className = "",
  children,
}: {
  /** Status of the response that failed: shows as "Error code: 409". */
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
