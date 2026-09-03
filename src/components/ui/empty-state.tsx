import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { SectionHeader } from "@/components/ui/section-header";

/**
 * 25 caixas tracejadas no projeto, com ~10 combinações de raio, cor de borda e
 * fundo. Uma forma só aqui, a mais frequente (7 das 25): raio xl, borda
 * tracejada em line-strong sobre surface-soft.
 */
export type EmptyStateProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  as?: "h2" | "h3" | "h4";
  action?: ReactNode;
  className?: string;
};

export function EmptyState({
  eyebrow,
  title,
  description,
  as = "h4",
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-xl)] border border-dashed border-[var(--color-line-strong)] bg-[var(--color-surface-soft)] p-6",
        className,
      )}
    >
      <SectionHeader eyebrow={eyebrow} title={title} description={description} as={as} />
      {action ? <div className="mt-5 flex flex-wrap gap-3">{action}</div> : null}
    </div>
  );
}
