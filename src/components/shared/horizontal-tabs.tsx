"use client";

import { useRef } from "react";

import { cn } from "@/lib/cn";

export type HorizontalTabItem = {
  value: string;
  label: string;
  disabled?: boolean;
  /** Counter next to the name (queue with pending items). Omitted = no badge. */
  count?: number;
};

type HorizontalTabsProps = {
  tabs: HorizontalTabItem[];
  activeValue: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
};

export function HorizontalTabs({
  tabs,
  activeValue,
  onChange,
  ariaLabel,
  className,
}: HorizontalTabsProps) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const enabledTabs = tabs.filter((tab) => !tab.disabled);
  // Tab enters the bar through the active tab and the arrows move within it (WAI-ARIA
  // tabs pattern). With no valid active tab, the first enabled one receives Tab.
  const focusValue = enabledTabs.some((tab) => tab.value === activeValue)
    ? activeValue
    : enabledTabs[0]?.value;

  // Arrows move one tab (wrapping around); Home and End go to the first and the last.
  function moveFocus(currentValue: string, key: string) {
    const currentIndex = enabledTabs.findIndex((tab) => tab.value === currentValue);
    const last = enabledTabs.length - 1;
    const jump: Record<string, number> = {
      ArrowRight: currentIndex === last ? 0 : currentIndex + 1,
      ArrowLeft: currentIndex <= 0 ? last : currentIndex - 1,
      Home: 0,
      End: last,
    };

    if (currentIndex === -1 || !(key in jump)) {
      return false;
    }

    const nextTab = enabledTabs[jump[key]];
    const nextTabIndex = tabs.findIndex((tab) => tab.value === nextTab.value);

    tabRefs.current[nextTabIndex]?.focus();
    onChange(nextTab.value);
    return true;
  }

  return (
    <div
      className={cn(
        "overflow-x-auto border-b border-[var(--color-line)]",
        className,
      )}
    >
      <div className="flex min-w-max gap-0" role="tablist" aria-label={ariaLabel}>
        {tabs.map((tab, index) => {
          const isActive = tab.value === activeValue;

          return (
            <button
              key={tab.value}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              type="button"
              role="tab"
              aria-selected={isActive}
              tabIndex={tab.value === focusValue ? 0 : -1}
              disabled={tab.disabled}
              onClick={() => onChange(tab.value)}
              onKeyDown={(event) => {
                if (moveFocus(tab.value, event.key)) {
                  event.preventDefault();
                }
              }}
              // Active = navy text and line (brass is for milestones, not selection).
              // The others stay in muted gray and the hover only darkens the text,
              // with no line. Same weight on all: bold only on the active one would change the
              // width and the bar would jump when switching.
              className={cn(
                "shrink-0 border-b-2 bg-transparent px-5 py-3 text-sm font-semibold transition duration-[180ms] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-60",
                isActive
                  ? "border-[var(--color-primary)] text-[var(--color-primary)]"
                  : "border-transparent text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]",
              )}
            >
              {tab.label}
              {typeof tab.count === "number" ? (
                <span
                  className={cn(
                    "ml-2 inline-grid min-w-[20px] place-items-center rounded-full px-1.5 text-[11px] font-bold leading-5 tabular-nums",
                    tab.count > 0
                      ? "bg-[var(--color-accent)] text-[var(--color-on-accent)]"
                      : "bg-[var(--color-surface-soft)] text-[var(--color-ink-soft)]",
                  )}
                >
                  {tab.count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
