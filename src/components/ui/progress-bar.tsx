import { cn } from "@/lib/cn";

/**
 * There were 15 hand-made bars, in 3 heights and 8 track colors; six tracks
 * (navy at 12%) vanished in the dark theme and 0% looked like "no bar". A single one here:
 * 6px, rounded corners, track --color-line (shows in both themes, but is
 * light: in the light theme it is ~1.8:1 against white) and fill in the text
 * brass, --color-accent-fg. The background brass (#c99a46) gave 1.44:1 against the
 * track; the text one gives ~3.7:1 in light and ~3.3:1 in dark, the 3:1 minimum
 * for what the bar shows (theme-tokens.test.tsx checks it).
 *
 * The number stays with the caller (each screen has its own format); the bar only
 * draws and tells the value to the screen reader.
 */
export type ProgressBarProps = {
  /** Percentage, from 0 to 100. Outside that it is clamped at the ends. */
  value: number;
  /** Accessible name of the bar ("Progress", "40% complete"). */
  label: string;
  /** Track: margin, width or the color over a photo and over a course's theme. */
  className?: string;
  /** Fill: only for the accent color of a members area. */
  fillClassName?: string;
  /**
   * Steps ("Step 1 of 2", "Question 3 of 8"): the screen reader keeps hearing
   * the step, from 1 to the total, and the `label` phrase; `value` only draws.
   */
  step?: { current: number; total: number };
};

export function ProgressBar({ value, label, className, fillClassName, step }: ProgressBarProps) {
  const percent = Math.max(0, Math.min(100, value));

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={step ? step.current : percent}
      aria-valuemin={step ? 1 : 0}
      aria-valuemax={step ? step.total : 100}
      aria-valuetext={step ? label : undefined}
      className={cn("h-1.5 overflow-hidden rounded-full bg-[var(--color-line)]", className)}
    >
      {/* Slides with transform, not with width: the motion contract only animates
          transform and opacity, and only for people who did not ask for less motion. */}
      <div
        className={cn(
          "h-full w-full rounded-full bg-[var(--color-accent-fg)] motion-safe:transition-transform motion-safe:duration-[var(--duration-slow)] motion-safe:ease-[var(--ease-standard)]",
          fillClassName,
        )}
        style={{ transform: `translateX(-${100 - percent}%)` }}
      />
    </div>
  );
}
