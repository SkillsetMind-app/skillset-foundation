import { useState } from "react";

import { cn } from "@/lib/cn";

/**
 * O check e o selo de marco do catálogo de movimento, fora de spot-art.tsx:
 * a sala do aluno importa só isto, sem arrastar as cinco cenas para o chunk
 * dela.
 *
 * Os dois só se mexem com `animate`, e quem passa `animate` é a MUDANÇA (ver
 * useJustDone): abrir a tela com tudo pronto não vira festa.
 */

const empty: ReadonlySet<string> = new Set();

/**
 * Os ids que viraram "feito" com a tela aberta. A primeira leitura com
 * `ready` é a linha de base: o que já estava feito ao abrir não conta, nem o
 * que só chegou atrasado de uma leitura (por isso o `ready`). Desfazer e
 * refazer conta de novo.
 *
 * Guardar a linha de base no estado durante o render é o padrão do React para
 * "valor do render anterior"; o setState só roda quando a lista muda.
 */
export function useJustDone(doneIds: readonly string[], ready = true): ReadonlySet<string> {
  const key = doneIds.join("\n");
  const [seen, setSeen] = useState<{ key: string; base: ReadonlySet<string> } | null>(null);
  if (ready && seen?.key !== key) {
    setSeen({
      key,
      base: new Set(seen ? doneIds.filter((id) => seen.base.has(id)) : doneIds),
    });
  }
  if (!ready || !seen) {
    return empty;
  }
  return new Set(doneIds.filter((id) => !seen.base.has(id)));
}

/**
 * Check que se desenha (catálogo de movimento, item 5). O mesmo traço do
 * `Check` do lucide; `pathLength=1` deixa o CSS animar o stroke-dashoffset sem
 * medir o caminho. Sem `animate`, ou com "reduzir movimento", nasce inteiro.
 */
export function DrawnCheck({
  size = 15,
  strokeWidth = 2.4,
  animate = false,
  className,
}: {
  size?: number;
  strokeWidth?: number;
  animate?: boolean;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      data-drawn-check=""
      // `drawn-check` é a classe que anima: só entra quando o item acabou de
      // ficar pronto.
      className={cn("shrink-0", animate && "drawn-check", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6 9 17l-5-5" pathLength={1} />
    </svg>
  );
}

/**
 * O selo de marco (barra em 100%): a geometria do VerifiedSeal, em latão com
 * check marinho (6,67:1). Decorativo: o número ao lado já diz "100%". Com
 * `animate`, cresce de 0,6 para 1 com um leve passar do ponto.
 */
export function MilestoneSeal({ animate = false, className }: { animate?: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="18"
      height="18"
      aria-hidden="true"
      focusable="false"
      data-milestone-seal=""
      className={cn("shrink-0", animate && "milestone-seal", className)}
    >
      <rect width="16" height="16" rx="4" fill="var(--color-accent,#c99a46)" />
      <path d="M4.2 8.3 6.9 11l4.9-5.6" fill="none" stroke="#091d2f" strokeWidth="2" strokeLinecap="square" />
    </svg>
  );
}
