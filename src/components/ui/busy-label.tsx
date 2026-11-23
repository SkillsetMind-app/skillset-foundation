import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export type BusyLabelProps = {
  busy: boolean;
  /** O rótulo de repouso ("Save"). */
  idle: ReactNode;
  /** O rótulo da espera ("Saving..."). Continua escrito: quem espera lê o que está acontecendo. */
  busyText: ReactNode;
  className?: string;
};

/**
 * Rótulo de botão que espera sem mudar de largura. Os dois textos moram na
 * mesma célula da grade (o truque dos passos do tour de boas-vindas), então a
 * célula tem sempre a largura do maior e o botão não encolhe nem cresce ao
 * salvar, o que fazia os vizinhos pularem. O que não vale agora fica invisível
 * e fora da árvore de acessibilidade: o nome do botão é sempre o texto à vista.
 */
export function BusyLabel({ busy, idle, busyText, className }: BusyLabelProps) {
  return (
    <span className={cn("inline-grid justify-items-center", className)}>
      <span
        aria-hidden={busy || undefined}
        className={cn("flex items-center justify-center gap-2 [grid-area:1/1]", busy && "invisible")}
      >
        {idle}
      </span>
      <span
        aria-hidden={busy ? undefined : true}
        className={cn("flex items-center justify-center gap-2 [grid-area:1/1]", !busy && "invisible")}
      >
        {busyText}
      </span>
    </span>
  );
}
