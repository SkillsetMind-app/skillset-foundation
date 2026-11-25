"use client";

import type { ReactNode } from "react";

/**
 * The only segmented selector in the Studio (one among a few options, a filter, not
 * section tabs). The home uses 3M/6M/12M/All; the reports page uses
 * 7d/30d/90d/12M/All; Members switches spaces/communities. In the learner area:
 * courses in progress/completed, credential filters and the plans' billing
 * cycle. Same markup, same pressed state. Tabs that switch
 * sections are HorizontalTabs.
 */
export function PeriodTabs<Option extends string>({
  options,
  value,
  onChange,
  label,
  renderLabel,
  wrap = false,
}: {
  options: readonly Option[];
  value: Option;
  onChange: (next: Option) => void;
  label: string;
  // ReactNode, not just string: the billing cycle shows the annual discount
  // in a smaller run inside the button itself.
  renderLabel: (option: Option) => ReactNode;
  // Wraps the line instead of scrolling inside (options with a number, which on a
  // narrow screen were hidden behind the scroll). Default: one line.
  wrap?: boolean;
}) {
  return (
    <div className={wrap ? "studio-range-tabs studio-range-tabs--wrap" : "studio-range-tabs"} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className={value === option ? "is-active" : undefined}
        >
          {renderLabel(option)}
        </button>
      ))}
    </div>
  );
}
