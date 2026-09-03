import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { Eyebrow } from "@/components/ui/eyebrow";

/**
 * Desvio consciente da especificação: ela propunha título em "text-lg
 * font-semibold" (8 usos no código). A forma que o app realmente repete é
 * eyebrow + "display-title mt-3 text-3xl" + descrição — 36 usos em 26
 * arquivos, incluindo os dois arquivos migrados nesta onda. O primitivo
 * segue o que existe, não o que a especificação imaginou.
 */
export type SectionHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  as?: "h2" | "h3" | "h4";
  actions?: ReactNode;
  className?: string;
};

export function SectionHeader({
  eyebrow,
  title,
  description,
  as: Heading = "h2",
  actions,
  className,
}: SectionHeaderProps) {
  return (
    <div
      className={cn(
        actions && "flex flex-wrap items-start justify-between gap-4",
        className,
      )}
    >
      <div>
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <Heading
          className={cn(
            "display-title text-3xl text-[var(--color-primary)]",
            eyebrow && "mt-3",
          )}
        >
          {title}
        </Heading>
        {description ? (
          <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--color-ink-soft)]">
            {description}
          </p>
        ) : null}
      </div>
      {actions}
    </div>
  );
}
