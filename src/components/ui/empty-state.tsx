import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { Eyebrow } from "@/components/ui/eyebrow";

/**
 * 25 caixas tracejadas no projeto, com ~10 combinações de raio, cor de borda e
 * fundo. Uma forma só aqui, a mais frequente (7 das 25): raio xl, borda
 * tracejada em line-strong sobre surface-soft.
 *
 * O título é o sans do estúdio, não a serifa de 30px do SectionHeader: um
 * estado vazio é uma frase de orientação, não a manchete da tela.
 */
export type EmptyStateProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  as?: "h2" | "h3" | "h4";
  action?: ReactNode;
  /** Cena de ui/spot-art.tsx. Entra subindo 6px (catálogo de movimento, item 10). */
  art?: ReactNode;
  className?: string;
};

export function EmptyState({
  eyebrow,
  title,
  description,
  as: Heading = "h4",
  action,
  art,
  className,
}: EmptyStateProps) {
  const body = (
    <div className="min-w-0">
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <Heading
        className={cn(
          "text-lg font-semibold leading-snug text-[var(--color-primary)]",
          eyebrow && "mt-2",
        )}
      >
        {title}
      </Heading>
      {description ? (
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--color-ink-soft)]">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-5 flex flex-wrap gap-3">{action}</div> : null}
    </div>
  );

  return (
    <div
      className={cn(
        "rounded-lg border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface-soft)] p-6",
        art && "flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:gap-7",
        className,
      )}
    >
      {art ? <div className="empty-state__art spot-art-in">{art}</div> : null}
      {body}
    </div>
  );
}
