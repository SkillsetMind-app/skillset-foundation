"use client";

import { useEffect, useState } from "react";
import { Copy } from "lucide-react";

import { useTranslation } from "@/components/i18n/i18n-provider";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Short, stable form of the id: in a UUID, the first 8 characters, in
 * uppercase. It is what the learner or the teacher dictates to support when
 * "I bought and did not get in"; support finds the order by the start of the id.
 * No new column: it always comes out the same from the same id.
 *
 * An id that is not a UUID (the subscription renewal uses the Stripe invoice id,
 * "in_1MtHbE...") comes out whole: cut and without the "_", the start found nothing,
 * and the first characters were the same on every renewal.
 */
export function shortId(id: string): string {
  return uuidPattern.test(id) ? id.slice(0, 8).toUpperCase() : id;
}

export function ShortId({ id, label }: { id: string; label: string }) {
  const { t } = useTranslation();
  const [result, setResult] = useState<"copied" | "failed" | null>(null);
  const value = shortId(id);

  // "Copied" disappears by itself; the failure notice stays, because it says what to do.
  useEffect(() => {
    if (result !== "copied") return;
    const timer = setTimeout(() => setResult(null), 2000);
    return () => clearTimeout(timer);
  }, [result]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setResult("copied");
    } catch {
      setResult("failed");
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-xs text-[var(--color-ink-soft)]">
      <span>{label}</span>
      <code className="font-mono font-semibold tracking-[0.08em] text-[var(--color-ink)] [overflow-wrap:anywhere]">{value}</code>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={t("shortId.copy").replace("{id}", () => value)}
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-[var(--color-line)] bg-white text-[var(--color-ink-soft)] hover:text-[var(--color-primary)]"
      >
        <Copy aria-hidden="true" size={13} />
      </button>
      <span role="status" aria-live="polite" className={result === "failed" ? "text-[var(--color-danger-fg)]" : undefined}>
        {result ? t(`shortId.${result}`) : ""}
      </span>
    </span>
  );
}
