import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { Eyebrow } from "@/components/ui/eyebrow";

/**
 * A conscious deviation from the specification: it proposed a title in "text-lg
 * font-semibold" (8 uses in the code). The form the app really repeats is
 * eyebrow + "display-title mt-3 text-3xl" + description — 36 uses in 26
 * files, including the two files migrated in this wave. The primitive
 * follows what exists, not what the specification imagined.
 */
export type SectionHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  as?: "h2" | "h3" | "h4";
  actions?: ReactNode;
  className?: string;
  /**
   * "card": card title inside a page that already has the headline in
   * serif. Without this the Storefront had three headlines (48, 30 and 30px) under the
   * same label. The default stays "display" for the other uses.
   */
  size?: "display" | "card";
};

export function SectionHeader({
  eyebrow,
  title,
  description,
  as: Heading = "h2",
  actions,
  className,
  size = "display",
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
            size === "card"
              ? "text-lg font-semibold text-[var(--color-ink)]"
              : "display-title text-3xl text-[var(--color-primary)]",
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
