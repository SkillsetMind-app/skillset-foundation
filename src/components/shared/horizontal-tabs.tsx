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
  // Tab entra na barra pela aba ativa e as setas andam dentro dela (padrão de
  // abas da WAI-ARIA). Sem ativa válida, a primeira habilitada recebe o Tab.
  const focusValue = enabledTabs.some((tab) => tab.value === activeValue)
    ? activeValue
    : enabledTabs[0]?.value;

  // Setas andam uma aba (com volta); Home e End vão à primeira e à última.
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
              // Ativa = texto navy e linha (latão é de marco, não de seleção).
              // As outras ficam no cinza apagado e o hover só escurece o texto,
              // sem linha. Mesmo peso em todas: negrito só na ativa mudaria a
              // largura e a barra pularia ao trocar.
              className={cn(
                "shrink-0 border-b-2 bg-transparent px-5 py-3 text-sm font-semibold transition duration-[180ms] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-50",
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
