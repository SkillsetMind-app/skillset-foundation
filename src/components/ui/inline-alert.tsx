import { AlertCircle, AlertTriangle, CheckCircle2, Info, type LucideIcon } from "lucide-react";
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

// Um ícone por tom: sem ele a única diferença entre erro, aviso e sucesso era a
// cor, e quem não distingue vermelho de verde ficava sem sinal nenhum.
const toneIcon: Record<AlertTone, LucideIcon> = {
  error: AlertCircle,
  warning: AlertTriangle,
  success: CheckCircle2,
  info: Info,
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
  // Seis telas de professor e admin já arrumam os próprios filhos em flex (uma
  // com o próprio ícone). Elas seguem como antes, sem ícone nem miolo: o ícone
  // novo não pode empurrar o botão nem dobrar o símbolo delas.
  const ownLayout = /(^|\s)flex(\s|$)/.test(className ?? "");
  const Icon = toneIcon[tone];
  const content = (
    <>
      {title ? <p className="font-bold">{title}</p> : null}
      {children}
    </>
  );

  return (
    <div
      role={urgent ? "alert" : "status"}
      aria-live={urgent ? "assertive" : "polite"}
      className={cn(
        "rounded-md border px-4 py-3 text-sm font-semibold leading-6",
        !ownLayout && "flex items-start gap-2",
        toneClass[tone],
        className,
      )}
    >
      {ownLayout ? (
        content
      ) : (
        <>
          {/* h-[1lh]: a caixa do ícone tem a altura de UMA linha do texto, então
              ele fica centrado na primeira linha em qualquer tamanho (text-xs ou
              text-sm) e o texto que quebra alinha embaixo do texto, não dele. */}
          <span className="flex h-[1lh] shrink-0 items-center">
            <Icon aria-hidden="true" size={16} strokeWidth={2.2} />
          </span>
          {/* Frase simples fica direto na caixa, como antes (é o caso de quase
              todos os usos); título ou trechos com link ganham um miolo, para
              não virarem colunas lado a lado. */}
          {title || typeof children !== "string" ? <div className="min-w-0 flex-1">{content}</div> : children}
        </>
      )}
    </div>
  );
}
