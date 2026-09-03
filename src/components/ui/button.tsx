import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

export type ButtonVariant = "solid" | "outline" | "danger" | "ghost";
export type ButtonSize = "sm" | "md";

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
  // Sem classe global: fundo transparente que só ganha cor no hover.
  ghost:
    "border border-transparent bg-transparent text-[var(--color-ink-soft)] hover:bg-[var(--color-surface-soft)] hover:text-[var(--color-ink)]",
};

const sizeClass: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2.5 text-sm",
};

const base =
  "inline-flex items-center justify-center gap-2 rounded-[var(--radius-md)] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";

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
};

export function Button({
  variant = "solid",
  size = "md",
  fullWidth = false,
  className,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      // Sem type explícito, todo botão dentro de <form> envia o formulário.
      type={type}
      className={buttonClasses({ variant, size, fullWidth }, className)}
      {...rest}
    />
  );
}
