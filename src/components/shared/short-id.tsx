"use client";

import { useState } from "react";
import { Copy } from "lucide-react";

import { useTranslation } from "@/components/i18n/i18n-provider";

/**
 * Forma curta e estável do id (UUID): os 8 primeiros caracteres, em
 * maiúsculas. É o que o aluno ou o professor dita para o suporte quando
 * "comprei e não entrou"; o suporte acha o pedido pelo começo do id.
 * Sem coluna nova: sai sempre igual do mesmo id.
 */
export function shortId(id: string): string {
  return id.replace(/[^a-z0-9]/gi, "").slice(0, 8).toUpperCase();
}

export function ShortId({ id, label }: { id: string; label: string }) {
  const { t } = useTranslation();
  const [result, setResult] = useState<"copied" | "failed" | null>(null);
  const value = shortId(id);

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
      <code className="font-mono font-semibold tracking-[0.08em] text-[var(--color-ink)]">{value}</code>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={t("shortId.copy").replace("{id}", () => value)}
        className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-md border border-[var(--color-line)] bg-white text-[var(--color-ink-soft)] hover:text-[var(--color-primary)]"
      >
        <Copy aria-hidden="true" size={13} />
      </button>
      <span role="status" className={result === "failed" ? "text-[var(--color-danger-fg)]" : undefined}>
        {result ? t(`shortId.${result}`) : ""}
      </span>
    </span>
  );
}
