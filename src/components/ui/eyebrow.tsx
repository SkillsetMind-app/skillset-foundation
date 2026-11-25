import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * The project uses 14 distinct tracking values. Filtering for only the classic
 * eyebrow leaves 5, and 0.22em is by far the most used. A single value.
 *
 * The size stays at text-xs (12px), which is what the screens already use and respects the
 * 11px floor: tight small caps below that become a stamp — legible to
 * whoever designed it, illegible to whoever reads it.
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
