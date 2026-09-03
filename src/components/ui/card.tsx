import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

type CardTone = "surface" | "soft" | "strong";
type CardPadding = "none" | "sm" | "md" | "lg";

/**
 * Emite utilitários que apontam para as variáveis de design em vez de usar a
 * classe global .surface-card: ela está definida DUAS vezes (globals.css:558 e
 * :671) e a segunda vence, trocando o fundo por rgba(255,255,255,0.92) mais um
 * backdrop-filter que ninguém pediu, e perdendo o raio.
 *
 * Usar bg-[var(--color-surface)] em vez de bg-white também tira o cartão da
 * regra global do tema escuro ([data-theme="dark"] .bg-white, com !important),
 * que hoje atropela até a exceção .keep-white do certificado.
 */
const toneClass: Record<CardTone, string> = {
  surface: "bg-[var(--color-surface)]",
  soft: "bg-[var(--color-surface-soft)]",
  strong: "bg-[var(--color-surface-strong)]",
};

const paddingClass: Record<CardPadding, string> = {
  none: "",
  sm: "p-4",
  md: "p-4 sm:p-6",
  lg: "p-6",
};

export type CardProps = {
  as?: "div" | "section" | "article";
  tone?: CardTone;
  padding?: CardPadding;
  interactive?: boolean;
  className?: string;
  children: ReactNode;
};

export function Card({
  as: Tag = "div",
  tone = "surface",
  padding = "md",
  interactive = false,
  className,
  children,
}: CardProps) {
  return (
    <Tag
      className={cn(
        "rounded-[var(--radius-xl)] border border-[var(--color-line)] shadow-[var(--shadow-soft)]",
        toneClass[tone],
        paddingClass[padding],
        interactive &&
          "transition hover:-translate-y-0.5 hover:border-[var(--color-line-strong)] hover:shadow-[var(--shadow-strong)]",
        className,
      )}
    >
      {children}
    </Tag>
  );
}
