"use client";

import { cn } from "@/lib/cn";

export type HorizontalTabItem = {
  value: string;
  label: string;
  disabled?: boolean;
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
  return (
    <div
      className={cn(
        "overflow-x-auto border-b border-[var(--color-line)]",
        className,
      )}
    >
      <div className="flex min-w-max gap-0" role="tablist" aria-label={ariaLabel}>
        {tabs.map((tab) => {
          const isActive = tab.value === activeValue;

          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={isActive}
              disabled={tab.disabled}
              onClick={() => onChange(tab.value)}
              className={cn(
                "shrink-0 border-b-2 border-transparent bg-transparent px-5 py-3 text-sm font-semibold text-[var(--color-ink-soft)] transition duration-[180ms] hover:text-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-50",
                isActive && "border-[var(--color-accent-fg)] text-[var(--color-primary)]",
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
