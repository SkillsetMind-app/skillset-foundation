import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

type AlertTone = "error" | "warning" | "success" | "info";

/**
 * O projeto tem 187 superfícies pintadas de vermelho de erro e 23 role="alert"
 * no total. Ou seja: a esmagadora maioria das mensagens de erro nunca é
 * anunciada por leitor de tela — quem não enxerga a tela envia o formulário,
 * nada acontece de audível, e a pessoa não sabe que falhou.
 *
 * O anúncio não é uma prop opcional aqui. Vem junto com a cor, sempre.
 */
const toneClass: Record<AlertTone, string> = {
  error:
    "border-[rgba(178,34,52,0.2)] bg-[var(--color-danger-soft)] text-[var(--color-danger-fg)]",
  warning:
    "border-[var(--color-warning)] bg-[var(--color-warning-soft)] text-[var(--color-warning-fg)]",
  success:
    "border-[var(--color-success)] bg-[var(--color-success-soft)] text-[var(--color-success-fg)]",
  info: "border-[var(--color-line)] bg-[var(--color-info-soft)] text-[var(--color-ink-soft)]",
};

export type InlineAlertProps = {
  tone: AlertTone;
  title?: string;
  className?: string;
  children: ReactNode;
};

export function InlineAlert({ tone, title, className, children }: InlineAlertProps) {
  // "assertive" interrompe a leitura para dar a má notícia; "polite" espera a
  // frase corrente terminar. Erro é a única coisa que merece interromper.
  const urgent = tone === "error";

  return (
    <div
      role={urgent ? "alert" : "status"}
      aria-live={urgent ? "assertive" : "polite"}
      className={cn(
        "rounded-[var(--radius-md)] border px-4 py-3 text-sm font-semibold leading-6",
        toneClass[tone],
        className,
      )}
    >
      {title ? <p className="font-bold">{title}</p> : null}
      {children}
    </div>
  );
}
