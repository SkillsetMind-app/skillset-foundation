import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * O pior buraco do inventário: 138 rótulos no projeto, e a ligação entre
 * campo, dica e mensagem de erro existe em DOIS lugares (2 aria-describedby,
 * 2 aria-invalid). Quem usa leitor de tela preenche o formulário, erra um
 * campo, e não recebe nem qual campo nem o porquê.
 *
 * Aqui isso não é opcional: o children recebe as props de acessibilidade
 * prontas para espalhar no controle, então o autor não precisa lembrar.
 *
 * O `id` vem de fora em vez de useId() de propósito — useId é hook, hook
 * obriga "use client", e a maioria dos chamadores já tem um id por causa do
 * htmlFor. Componente de servidor sai mais barato que a conveniência.
 */
export type FieldA11y = {
  id: string;
  "aria-invalid": boolean;
  "aria-describedby": string | undefined;
  required: boolean;
};

export type FieldProps = {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
  children: (a11y: FieldA11y) => ReactNode;
};

export function Field({
  id,
  label,
  hint,
  error,
  required = false,
  className,
  children,
}: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  // Os dois juntos e nessa ordem: o leitor de tela anuncia a dica antes do
  // erro, que é a ordem em que a pessoa precisa deles.
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("grid gap-2", className)}>
      <label htmlFor={id} className="text-sm font-semibold text-[var(--color-ink)]">
        {label}
        {required ? (
          <span aria-hidden="true" className="ml-1 text-[var(--color-danger-fg)]">
            *
          </span>
        ) : null}
      </label>

      {hint ? (
        <p id={hintId} className="text-xs leading-5 text-[var(--color-ink-soft)]">
          {hint}
        </p>
      ) : null}

      {children({
        id,
        "aria-invalid": Boolean(error),
        "aria-describedby": describedBy,
        required,
      })}

      {error ? (
        // role="alert" porque o erro aparece DEPOIS do envio: sem ele, a
        // mensagem entra na página em silêncio.
        <p
          id={errorId}
          role="alert"
          className="text-sm font-semibold text-[var(--color-danger-fg)]"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
