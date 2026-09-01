"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

type CourseCategorySelectProps = {
  options: readonly string[];
  selected: string[];
  onToggle: (value: string) => void;
  disabled?: boolean;
  max?: number;
};

export function CourseCategorySelect({
  options,
  selected,
  onToggle,
  disabled = false,
  max = 5,
}: CourseCategorySelectProps) {
  const [open, setOpen] = useState(false);
  const optionsId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const atMax = selected.length >= max;
  const visibleOptions = [
    ...selected.filter((item) => !options.includes(item)),
    ...options,
  ];

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative font-normal">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-controls={optionsId}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-11 w-full items-center gap-2 rounded-[8px] border border-[var(--color-line)] bg-white px-3.5 py-2 text-left text-sm outline-none transition-colors focus-visible:border-[var(--color-primary-light)] focus-visible:ring-2 focus-visible:ring-[rgba(66,102,145,0.18)] disabled:bg-[var(--color-surface-soft)] disabled:opacity-60"
      >
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {selected.length === 0 ? (
            <span className="text-[var(--color-ink-muted)]">
              Select up to {max} categories
            </span>
          ) : (
            selected.map((item, index) => (
              <span
                key={item}
                className={`inline-flex items-center gap-1 rounded-[6px] px-2 py-0.5 text-xs font-semibold ${
                  index === 0
                    ? "bg-[var(--color-primary)] text-[var(--color-base)]"
                    : "bg-[var(--color-surface-strong)] text-[var(--color-ink)]"
                }`}
              >
                {item}
                {index === 0 ? (
                  <span className="text-[9px] font-bold uppercase tracking-wide opacity-80">
                    Primary
                  </span>
                ) : null}
              </span>
            ))
          )}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-[var(--color-ink-muted)]">
          {selected.length}/{max}
        </span>
        <ChevronDown
          aria-hidden="true"
          size={16}
          strokeWidth={1.8}
          className={`shrink-0 text-[var(--color-ink-muted)] transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open ? (
        <div
          id={optionsId}
          role="group"
          aria-label="Course categories"
          className="course-category-menu absolute z-30 mt-2 max-h-64 w-full overflow-y-auto rounded-[8px] border border-[var(--color-line)] bg-white p-1.5 shadow-[var(--shadow-strong)]"
        >
          {visibleOptions.map((item) => {
            const isSelected = selected.includes(item);
            const isLockedOut = !isSelected && atMax;
            const isRequiredSelection = isSelected && selected.length === 1;

            return (
              <label
                key={item}
                // O `title` mora AQUI, no rótulo visível, e não mais no input.
                // O input é `sr-only` — 1px recortado —, então o texto que
                // explicava por que o clique não faz nada estava preso num
                // elemento que o mouse nunca alcança: a última categoria
                // simplesmente não respondia, sem uma palavra de explicação.
                title={
                  isRequiredSelection
                    ? "Pick the new category first — a course needs at least one."
                    : isLockedOut
                      ? "Maximum categories selected. Remove one to add another."
                      : undefined
                }
                className={`flex w-full items-center gap-2.5 rounded-[6px] px-3 py-2 text-left text-sm transition-colors ${
                  isSelected
                    ? "bg-[var(--color-surface-soft)] font-semibold text-[var(--color-primary)]"
                    : "text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)]"
                } ${isLockedOut ? "cursor-not-allowed opacity-40" : isRequiredSelection ? "cursor-not-allowed" : "cursor-pointer"}`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  disabled={isLockedOut || isRequiredSelection}
                  onChange={() => onToggle(item)}
                  aria-label={item}
                  className="peer sr-only"
                />
                <span
                  className={`grid size-4 shrink-0 place-items-center rounded-[4px] border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-[rgba(66,102,145,0.28)] peer-focus-visible:ring-offset-2 ${
                    isSelected
                      ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-base)]"
                      : "border-[var(--color-line-strong)] bg-white"
                  }`}
                >
                  {isSelected ? (
                    <Check aria-hidden="true" size={11} strokeWidth={3} />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1 truncate">{item}</span>
              </label>
            );
          })}
          {/* Dica visível, não só `title`: no celular não existe hover, e a
              regra ("a última não sai") é justamente a que trava o clique. */}
          {selected.length === 1 ? (
            <p className="px-3 py-2 text-[11px] leading-4 text-[var(--color-ink-muted)]">
              To swap the category, pick the new one first — a course needs at
              least one.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
