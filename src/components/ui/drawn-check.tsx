import { useState } from "react";

import { cn } from "@/lib/cn";

/**
 * The check and the milestone seal from the motion catalog, kept out of spot-art.tsx:
 * the learner room imports only this, without dragging the five scenes into its
 * chunk.
 *
 * Both only move with `animate`, and what passes `animate` is the CHANGE (see
 * useJustDone): opening the screen with everything done is not a celebration.
 */

const empty: ReadonlySet<string> = new Set();

/**
 * The ids that became "done" with the screen open. The first read with
 * `ready` is the baseline: what was already done on open does not count, nor does
 * what only arrived late from a read (hence the `ready`). Undoing and
 * redoing counts again.
 *
 * Keeping the baseline in state during render is React's pattern for
 * "value from the previous render"; setState only runs when the list changes.
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
 * A check that draws itself (motion catalog, item 5). The same stroke as lucide's
 * `Check`; `pathLength=1` lets the CSS animate stroke-dashoffset without
 * measuring the path. Without `animate`, or with "reduce motion", it is born whole.
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
      // `drawn-check` is the class that animates: it only goes in when the item just
      // became done.
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
 * The milestone seal (bar at 100%): the geometry of VerifiedSeal, in brass with a
 * navy check (6.67:1). Decorative: the number beside it already says "100%". With
 * `animate`, it grows from 0.6 to 1 with a slight overshoot.
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
