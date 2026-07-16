import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export type PlanSelectorOption<TValue extends string> = {
  value: TValue;
  title: string;
  description: string;
  features: string[];
  icon: LucideIcon;
  disabled?: boolean;
  badge?: string;
};

type PlanSelectorCardsProps<TValue extends string> = {
  label: ReactNode;
  options: PlanSelectorOption<TValue>[];
  value: TValue;
  onChange: (value: TValue) => void;
  disabled?: boolean;
  className?: string;
};

export function PlanSelectorCards<TValue extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
  className,
}: PlanSelectorCardsProps<TValue>) {
  return (
    <fieldset className={cn("grid gap-4", className)}>
      <legend className="text-sm font-semibold text-[var(--color-ink)]">
        {label}
      </legend>
      <div className="grid gap-4 md:grid-cols-2">
        {options.map((option) => {
          const Icon = option.icon;
          const isSelected = option.value === value;
          const isDisabled = disabled || option.disabled;

          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={isSelected}
              disabled={isDisabled}
              onClick={() => onChange(option.value)}
              className={cn(
                "group grid gap-4 rounded-[14px] border-2 bg-white p-5 text-left transition duration-[180ms] ease-out",
                "hover:-translate-y-0.5 hover:border-[rgba(26,54,93,0.22)] hover:shadow-[var(--shadow-soft)]",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[rgba(26,54,93,0.28)]",
                isSelected
                  ? "border-[var(--color-accent-fg)] bg-[rgba(178,34,52,0.04)]"
                  : "border-[var(--color-line)]",
                isDisabled &&
                  "cursor-not-allowed opacity-55 hover:translate-y-0 hover:border-[var(--color-line)] hover:shadow-none",
              )}
            >
              <span className="flex items-start justify-between gap-3">
                <span>
                  <span className="display-title block text-xl font-semibold leading-tight text-[var(--color-primary)]">
                    {option.title}
                  </span>
                  <span className="mt-2 block text-sm leading-6 text-[var(--color-ink-soft)]">
                    {option.description}
                  </span>
                </span>
                <span
                  className={cn(
                    "grid size-10 shrink-0 place-items-center rounded-[10px] bg-[var(--color-surface-soft)] text-[var(--color-primary)]",
                    isSelected &&
                      "bg-[rgba(178,34,52,0.08)] text-[var(--color-accent-fg)]",
                  )}
                >
                  <Icon aria-hidden="true" size={18} />
                </span>
              </span>

              {option.badge ? (
                <span className="w-fit rounded-[8px] border border-[var(--color-line)] bg-[var(--color-surface-soft)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-ink-soft)]">
                  {option.badge}
                </span>
              ) : null}

              <span className="block border-t border-[var(--color-line)] pt-4">
                <span className="grid gap-2">
                  {option.features.map((feature) => (
                    <span
                      key={feature}
                      className="flex items-start gap-2 text-sm leading-6 text-[var(--color-ink)]"
                    >
                      <span
                        aria-hidden="true"
                        className="mt-2 size-1.5 rounded-full bg-[var(--color-success)]"
                      />
                      {feature}
                    </span>
                  ))}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
