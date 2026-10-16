"use client";

import { useRef } from "react";

import { cn } from "@/lib/cn";

export type HorizontalTabItem = {
  value: string;
  label: string;
  disabled?: boolean;
  /** Contador ao lado do nome (fila com itens pendentes). Omitido = sem badge. */
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

  function moveFocus(currentValue: string, direction: 1 | -1) {
    const currentIndex = enabledTabs.findIndex((tab) => tab.value === currentValue);

    if (currentIndex === -1 || enabledTabs.length === 0) {
      return;
    }

    const nextIndex = (currentIndex + direction + enabledTabs.length) % enabledTabs.length;
    const nextTab = enabledTabs[nextIndex];
    const nextTabIndex = tabs.findIndex((tab) => tab.value === nextTab.value);

    tabRefs.current[nextTabIndex]?.focus();
    onChange(nextTab.value);
  }

  return (
    <div
      className={cn(
        "overflow-x-auto border-b border-[var(--color-line)]",
        className,
      )}
    >
      <div className="flex min-w-max gap-0" role="group" aria-label={ariaLabel}>
        {tabs.map((tab, index) => {
          const isActive = tab.value === activeValue;

          return (
            <button
              key={tab.value}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              type="button"
              aria-pressed={isActive}
              disabled={tab.disabled}
              onClick={() => onChange(tab.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight") {
                  event.preventDefault();
                  moveFocus(tab.value, 1);
                }

                if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  moveFocus(tab.value, -1);
                }
              }}
              className={cn(
                "shrink-0 border-b-2 border-transparent bg-transparent px-5 py-3 text-sm font-semibold text-[var(--color-ink-soft)] transition duration-[180ms] hover:text-[var(--color-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-50",
                isActive && "border-[var(--color-accent-fg)] text-[var(--color-primary)]",
              )}
            >
              {tab.label}
              {typeof tab.count === "number" ? (
                <span
                  className={cn(
                    "ml-2 inline-grid min-w-[20px] place-items-center rounded-full px-1.5 text-[11px] font-bold leading-5 tabular-nums",
                    tab.count > 0
                      ? "bg-[var(--color-accent)] text-white"
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
