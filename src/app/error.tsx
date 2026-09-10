"use client";

import { useEffect } from "react";
import Link from "next/link";

import { captureException } from "@/lib/posthog/client";
import { useTranslation } from "@/components/i18n/i18n-provider";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useTranslation();
  useEffect(() => {
    captureException(error, { boundary: "route-segment", digest: error.digest });
  }, [error]);

  return (
    <main className="page-shell flex min-h-screen items-center justify-center px-6">
      <div className="surface-card max-w-2xl rounded-[18px] p-8 text-center sm:p-10">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--color-accent-fg)]">
          {t("appErrors.eyebrow")}
        </p>
        <h1 className="display-title mt-4 text-4xl text-[var(--color-ink)] sm:text-5xl">
          {t("appErrors.pageTitle")}
        </h1>
        <p className="mt-4 text-sm leading-7 text-[var(--color-ink-soft)]">
          {t("appErrors.pageBody")}
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="button-solid px-4 py-2.5 text-sm"
          >
            {t("appErrors.retry")}
          </button>
          <Link href="/" className="button-outline px-4 py-2.5 text-sm">
            {t("appErrors.home")}
          </Link>
        </div>
      </div>
    </main>
  );
}
