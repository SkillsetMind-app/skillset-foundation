import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * O projeto usa 14 valores distintos de tracking. Filtrando só o eyebrow
 * clássico sobram 5, e 0.22em é disparado o mais usado. Um valor só.
 *
 * O tamanho fica em text-xs (12px), que é o que as telas já usam e respeita o
 * piso de 11px: versalete apertado abaixo disso vira carimbo — legível para
 * quem desenhou, ilegível para quem lê.
 */
const toneClass = {
  accent: "text-[var(--color-accent-fg)]",
  muted: "text-[var(--color-ink-muted)]",
} as const;

export type EyebrowProps = {
  as?: "p" | "span" | "h2";
  tone?: keyof typeof toneClass;
  className?: string;
  children: ReactNode;
};

export function Eyebrow({
  as: Tag = "p",
  tone = "accent",
  className,
  children,
}: EyebrowProps) {
  return (
    <Tag
      className={cn(
        "text-xs font-bold uppercase tracking-[0.22em]",
        toneClass[tone],
        className,
      )}
    >
      {children}
    </Tag>
  );
}
