"use client";

import { useEffect } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { captureException } from "@/lib/posthog/client";

export type RouteErrorProps = {
  error: Error & { digest?: string };
  /** Only clears the error and redraws with what the browser already has. */
  reset: () => void;
  /** Reloads the route's data and then clears the error (Next 16.4+). */
  retry?: () => void;
};

/**
 * Error card for an AREA (/teach, /learn). Without it, a studio page
 * that broke fell into the root error, whose "Go home" leads to the public site: the
 * teacher left the product to recover from an error inside it. Here the
 * button goes back to the start of the area itself. Same design as `app/error.tsx`.
 *
 * Two cares so the buttons really work:
 * - "Try again" uses `retry`, which fetches the data again. Only `reset` redraws
 *   with the same server result, and the error comes back the same.
 * - "Go home" is a plain <a>, with a full reload. The error boundary only
 *   resets when the address changes; with <Link>, someone already on /teach
 *   would click and nothing would happen.
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
  /** Name that identifies the area in the error log. */
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
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- full reload on purpose: the error boundary only resets when the address changes, and <Link> to the same page would change nothing */}
          <a href={homeHref} className="button-outline px-4 py-2.5 text-sm">
            {t("appErrors.home")}
          </a>
        </div>
      </div>
    </main>
  );
}
