"use client";

import { useId, useState, type ReactNode } from "react";

/**
 * Lightweight, dependency-free Tooltip. Hover or focus the trigger
 * (any inline child) to surface a small dark bubble above it. ESC and
 * blur hide it. Mobile users see it on tap (focus) and on tap-out.
 *
 * Why hand-rolled instead of Radix/Floating UI:
 *  - 80 lines + 0 deps vs 100+ kb on first byte
 *  - We only need hover/focus + a single position (top); no portals,
 *    no collision detection, no animation engine
 *  - The trigger keeps its native semantics (button, link, etc.)
 *
 * Usage:
 *   <Tooltip content="Stripe fee passed through to creator">
 *     <span className="underline decoration-dotted">why?</span>
 *   </Tooltip>
 */
type TooltipProps = {
  content: ReactNode;
  /** Direction the bubble points. Defaults to top. */
  side?: "top" | "bottom";
  children: ReactNode;
  className?: string;
};

export function Tooltip({
  content,
  side = "top",
  children,
  className = "",
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const id = useId();

  const sideClass =
    side === "top"
      ? "bottom-full mb-2"
      : "top-full mt-2";
  const arrowClass =
    side === "top"
      ? "-bottom-1 border-l-transparent border-r-transparent border-t-[var(--color-primary)] border-b-transparent"
      : "-top-1 border-l-transparent border-r-transparent border-b-[var(--color-primary)] border-t-transparent";

  return (
    <span
      className={`relative inline-flex ${className}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
    >
      <span aria-describedby={open ? id : undefined}>{children}</span>
      {open ? (
        <span
          role="tooltip"
          id={id}
          className={`pointer-events-none absolute left-1/2 z-50 w-max max-w-[240px] -translate-x-1/2 rounded-[8px] bg-[var(--color-primary)] px-3 py-2 text-xs leading-5 text-[var(--color-base)] shadow-[0_10px_22px_rgba(15,39,68,0.18)] ${sideClass}`}
        >
          {content}
          <span
            aria-hidden="true"
            className={`absolute left-1/2 size-0 -translate-x-1/2 border-4 ${arrowClass}`}
          />
        </span>
      ) : null}
    </span>
  );
}
