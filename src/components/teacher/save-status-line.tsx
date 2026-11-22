"use client";

import { AlertCircle, CheckCircle2 } from "lucide-react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui";

/**
 * Erro com saída: a frase no vermelho de erro (anunciada) e, embaixo, um
 * "Try again" que repete o MESMO pedido. Antes o erro saía no cinza do sucesso
 * e a pessoa não tinha o que clicar além de recarregar a página.
 */
export function RetryAlert({ text, onRetry, className = "" }: { text: string; onRetry?: () => void; className?: string }) {
  const { t } = useTranslation();
  return (
    <div className={`grid justify-items-start gap-2 ${className}`}>
      <p
        role="alert"
        className="flex items-start gap-2.5 rounded-md border border-[rgba(178,34,52,0.3)] bg-[var(--color-danger-soft)] px-4 py-3 text-sm font-semibold leading-5 text-[var(--color-danger-fg)]"
      >
        <AlertCircle aria-hidden="true" size={18} className="mt-px shrink-0" />
        {text}
      </p>
      {onRetry ? (
        <Button variant="outline" onClick={onRetry}>
          {t("saveStatus.retry")}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * A linha ao lado do "Save" dos editores de botão (texto de venda e página de
 * venda). Ela só diz o que é verdade: "Unsaved changes" assim que o que está na
 * tela difere do último valor gravado, a frase de salvo só quando é igual, e o
 * erro com "Try again". Enquanto grava não diz nada: o próprio botão já diz
 * "Saving...". Antes o "Saved." ficava na tela enquanto a pessoa voltava a
 * digitar, e o que não estava salvo parecia salvo.
 */
export function SaveStatusLine({
  saving,
  dirty,
  savedText,
  errorText,
  onRetry,
}: {
  saving: boolean;
  dirty: boolean;
  /** Só depois de uma gravação que deu certo nesta visita. */
  savedText?: string;
  errorText?: string;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  if (saving) return null;
  if (errorText) return <RetryAlert text={errorText} onRetry={onRetry} className="basis-full" />;
  if (dirty) {
    return (
      <span role="status" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-ink-muted)]">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-[var(--color-ink-muted)]" />
        {t("saveStatus.unsaved")}
      </span>
    );
  }
  if (savedText) {
    return (
      <span role="status" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-success-fg)]">
        <CheckCircle2 aria-hidden="true" size={16} />
        {savedText}
      </span>
    );
  }
  return null;
}
