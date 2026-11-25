import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { Eyebrow } from "@/components/ui/eyebrow";

/**
 * 25 dashed boxes in the project, with ~10 combinations of radius, border color and
 * background. A single form here, the most frequent one (7 of the 25): xl radius, dashed
 * border in line-strong over surface-soft.
 *
 * The title is the studio sans, not the 30px serif of SectionHeader: an
 * empty state is a sentence of guidance, not the headline of the screen.
 */
export type EmptyStateProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  as?: "h2" | "h3" | "h4";
  action?: ReactNode;
  /** Scene from ui/spot-art.tsx. It enters rising 6px (motion catalog, item 10). */
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
