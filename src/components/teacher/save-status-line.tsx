"use client";

import { CheckCircle2 } from "lucide-react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { Button, InlineAlert } from "@/components/ui";

/**
 * Erro com saída: a frase no vermelho de erro (anunciada) e, embaixo, um
 * "Try again" que repete o MESMO pedido. Antes o erro saía no cinza do sucesso
 * e a pessoa não tinha o que clicar além de recarregar a página.
 */
export function RetryAlert({
  text,
  onRetry,
  busy = false,
  className = "",
}: {
  text: string;
  onRetry?: () => void;
  /** Tentando de novo: o aviso fica, e o botão mostra a espera. */
  busy?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className={`grid justify-items-start gap-2 ${className}`}>
      <InlineAlert tone="error">{text}</InlineAlert>
      {onRetry ? (
        // O mesmo "Try again" nas duas faces; só o anel entra, no lugar já guardado.
        <Button variant="outline" loading={busy} busyLabel={t("saveStatus.retry")} onClick={onRetry}>
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
  if (savedText) return <SavedNote text={savedText} />;
  return null;
}

/**
 * O "salvo" dos formulários do professor e da conta: check verde e a frase, na
 * mesma linha do botão que gravou. Antes cada painel tinha o seu (caixa azul,
 * caixa verde, texto cinza), e três deles nasciam ACIMA do botão, empurrando-o
 * uns 48px para baixo logo depois do clique. O erro continua no InlineAlert.
 */
export function SavedNote({ text }: { text: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-success-fg)]">
      <CheckCircle2 aria-hidden="true" size={16} className="shrink-0" />
      {text}
    </span>
  );
}
