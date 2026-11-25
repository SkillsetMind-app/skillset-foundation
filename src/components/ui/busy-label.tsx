import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export type BusyLabelProps = {
  busy: boolean;
  /** The resting label ("Save"). */
  idle: ReactNode;
  /** The waiting label ("Saving..."). It stays written out: whoever waits reads what is happening. */
  busyText: ReactNode;
  className?: string;
};

/**
 * Button label that waits without changing width. Both texts live in the
 * same grid cell (the trick from the welcome tour steps), so the
 * cell always has the width of the larger one and the button neither shrinks nor grows
 * on save, which used to make the neighbors jump. Whichever text does not apply now is invisible
 * and outside the accessibility tree: the button's name is always the visible text.
 */
export function BusyLabel({ busy, idle, busyText, className }: BusyLabelProps) {
  return (
    <span className={cn("inline-grid justify-items-center", className)}>
      <span
        aria-hidden={busy || undefined}
        className={cn("flex items-center justify-center gap-2 [grid-area:1/1]", busy && "invisible")}
      >
        {idle}
      </span>
      <span
        aria-hidden={busy ? undefined : true}
        className={cn("flex items-center justify-center gap-2 [grid-area:1/1]", !busy && "invisible")}
      >
        {busyText}
      </span>
    </span>
  );
}
