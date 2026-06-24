"use client";

import { useEffect } from "react";
import Link from "next/link";

import { captureException } from "@/lib/posthog/client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureException(error, { boundary: "route-segment", digest: error.digest });
  }, [error]);

  return (
    <main className="page-shell flex min-h-screen items-center justify-center px-6">
      <div className="surface-card max-w-2xl rounded-[18px] p-8 text-center sm:p-10">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[var(--color-brand)]">
          Something went wrong
        </p>
        <h1 className="display-title mt-4 text-4xl text-[var(--color-ink)] sm:text-5xl">
          This page hit an unexpected error.
        </h1>
        <p className="mt-4 text-sm leading-7 text-[var(--color-ink-soft)]">
          The issue has been logged and we&apos;re on it. You can try again or head
          back home.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="button-solid px-4 py-2.5 text-sm"
          >
            Try again
          </button>
          <Link href="/" className="button-outline px-4 py-2.5 text-sm">
            Go home
          </Link>
        </div>
      </div>
    </main>
  );
}
