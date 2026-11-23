"use client";

import { useRef, useState, type ReactNode, type RefObject } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { cn } from "@/lib/cn";

export type LoadErrorAlertProps = {
  children: ReactNode;
  /** Lê de novo. O aviso só sai quando a tela recebe os dados: quem decide é ela. */
  onRetry: () => Promise<unknown> | void;
  /** Nó que fica na tela nos dois desfechos e recebe o foco ao clicar. */
  focusRef: RefObject<HTMLElement | null>;
  /** Releitura que a tela acompanha por conta própria (router.refresh). */
  busy?: boolean;
  className?: string;
  /** Espaçamento do próprio aviso, para as telas que já o tinham compacto ou largo. */
  alertClassName?: string;
};

/**
 * Erro de LEITURA com saída: o aviso e um "Try again" que lê de novo. Eram
 * umas 39 mensagens "could not load" e só 7 com botão; o único jeito de sair
 * era recarregar a página no navegador. (O RetryAlert do professor é outro:
 * repete um salvamento, não uma leitura.)
 *
 * O botão trava enquanto a releitura corre (aria-busy, "Trying again...", na
 * mesma largura do "Try again").
 * Travado ele perde o foco, e some quando a leitura dá certo: por isso o foco
 * vai antes para `focusRef`, senão caía no <body>.
 */
export function LoadErrorAlert({
  children,
  onRetry,
  focusRef,
  busy = false,
  className,
  alertClassName,
}: LoadErrorAlertProps) {
  const { t } = useTranslation();
  const [retrying, setRetrying] = useState(false);
  // Trava também na própria função: dois cliques antes de a tela redesenhar
  // não abrem duas releituras.
  const inFlight = useRef(false);
  const locked = busy || retrying;

  async function retry() {
    if (inFlight.current || busy) return;
    inFlight.current = true;
    focusRef.current?.focus();
    setRetrying(true);
    try {
      await onRetry();
    } catch {
      // A falha da releitura já volta como erro na própria tela; o aviso fica.
    } finally {
      inFlight.current = false;
      setRetrying(false);
    }
  }

  return (
    <div className={cn("grid gap-3", className)}>
      <InlineAlert tone="error" className={alertClassName}>{children}</InlineAlert>
      <Button
        variant="outline"
        className="justify-self-start"
        loading={locked}
        busyLabel={t("appErrors.retrying")}
        onClick={() => void retry()}
      >
        {t("appErrors.retry")}
      </Button>
    </div>
  );
}
