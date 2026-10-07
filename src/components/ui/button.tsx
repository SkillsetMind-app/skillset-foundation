import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * Papéis: navy (`solid`) age; latão (`accent`) só nos dois marcos da jornada,
 * "Create product" e "Publish product". Latão nunca em erro, aviso ou apagar
 * (isso é `danger`).
 */
export type ButtonVariant = "solid" | "outline" | "danger" | "ghost" | "accent";
export type ButtonSize = "sm" | "md" | "lg";

/**
 * As classes globais (.button-solid e companhia, globals.css:1006+) definem
 * QUATRO coisas: borda, fundo, cor e sombra. Não definem raio, espaçamento,
 * peso da fonte nem alinhamento do ícone. Por isso cada um dos 361 usos delas
 * repetia à mão "inline-flex items-center gap-2 rounded-[10px] px-4 py-2
 * text-sm font-semibold". É esse resto que mora aqui.
 */
const variantClass: Record<ButtonVariant, string> = {
  solid: "button-solid",
  outline: "button-outline",
  danger: "button-danger",
  accent: "button-accent",
  // Sem classe global: fundo transparente que só ganha cor no hover.
  ghost:
    "border border-transparent bg-transparent text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-soft)] hover:text-[var(--color-ink)]",
};

const sizeClass: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "min-h-11 px-4 py-2.5 text-sm",
  // 48px e 15px/600 vêm de .button-lg (camada components).
  lg: "button-lg",
};

const base =
  "inline-flex items-center justify-center gap-2 rounded-md font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";

/**
 * A forma em texto, para quem precisa de <Link> vestido de botão — 40 arquivos
 * fazem isso. Um componente polimórfico para atender next/link custaria mais
 * tipo do que valor: o call site já escreve <Link>, só falta a roupa.
 */
export function buttonClasses(
  options: { variant?: ButtonVariant; size?: ButtonSize; fullWidth?: boolean } = {},
  className?: string,
) {
  const { variant = "solid", size = "md", fullWidth = false } = options;
  return cn(base, variantClass[variant], sizeClass[size], fullWidth && "w-full", className);
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  /** Ícone à esquerda do texto. Decorativo: o nome do botão é o texto. */
  icon?: ReactNode;
  /** Carregando: o spinner toma o lugar do ícone e o botão trava. */
  loading?: boolean;
};

export function Button({
  variant = "solid",
  size = "md",
  fullWidth = false,
  icon,
  loading = false,
  disabled,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      // Sem type explícito, todo botão dentro de <form> envia o formulário.
      type={type}
      className={buttonClasses({ variant, size, fullWidth }, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <Loader2 aria-hidden="true" size={16} strokeWidth={2.2} className="shrink-0 animate-spin" />
      ) : (
        icon
      )}
      {children}
    </button>
  );
}
