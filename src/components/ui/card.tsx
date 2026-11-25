import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

type CardTone = "surface" | "soft" | "strong";
type CardPadding = "none" | "sm" | "md" | "lg";

/**
 * Emits utilities that point to the design variables instead of using the
 * global class .surface-card: it is defined TWICE (globals.css:558 and
 * :671) and the second wins, swapping the background for rgba(255,255,255,0.92) plus a
 * backdrop-filter that nobody asked for, and losing the radius.
 *
 * Using bg-[var(--color-surface)] instead of bg-white also takes the card out of the
 * global dark theme rule ([data-theme="dark"] .bg-white, with !important),
 * which today even tramples the certificate's .keep-white exception.
 */
const toneClass: Record<CardTone, string> = {
  surface: "bg-[var(--color-surface)]",
  soft: "bg-[var(--color-surface-soft)]",
  strong: "bg-[var(--color-surface-strong)]",
};

const paddingClass: Record<CardPadding, string> = {
  none: "",
  sm: "p-4",
  md: "p-4 sm:p-6",
  lg: "p-6",
};

export type CardProps = {
  as?: "div" | "section" | "article" | "aside";
  tone?: CardTone;
  padding?: CardPadding;
  interactive?: boolean;
  /**
   * A card standing alone on the page lifts off the surface; a card inside a list
   * does not — 121 shadows against 432 hand-built borders, and most of the ones that
   * sit inside another box have no shadow at all. Without this escape hatch the
   * primitive does not suit a list row, which is where it appears most.
   */
  shadow?: boolean;
  className?: string;
  children: ReactNode;
};

export function Card({
  as: Tag = "div",
  tone = "surface",
  padding = "md",
  interactive = false,
  shadow = true,
  className,
  children,
}: CardProps) {
  return (
    <Tag
      className={cn(
        "rounded-lg border border-[var(--color-line)]",
        shadow && "shadow-[var(--shadow-soft)]",
        toneClass[tone],
        paddingClass[padding],
        interactive &&
          "transition hover:-translate-y-0.5 hover:border-[var(--color-line-strong)] hover:shadow-[var(--shadow-strong)]",
        className,
      )}
    >
      {children}
    </Tag>
  );
}
