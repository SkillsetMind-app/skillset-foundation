"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { LOCALES, LOCALE_LABELS, LOCALE_SHORT_LABELS, type Locale } from "@/lib/i18n/config";

// A custom menu instead of <select>: the native popup is drawn by the browser and
// does not accept CSS ("looks like a raw little list", 07/09). It opens and closes like the
// site's other menus (public-entry-menu, studio kebab): clicking outside closes it,
// Escape closes it and returns focus to the trigger. Each option is a native <button>,
// so Enter/Space choose on their own and the global focus ring already covers it;
// ↑/↓/Home/End move through the list. `dropUp` is for the footer, where opening
// downward would fall off the page. No close on blur, on purpose: in Safari the
// click does not focus the button, and the blur would close the menu before the option's click.
//
// `variant="compact"` is for use inside an icon bar (platform top,
// site bar): an abbreviation with no permanent frame; the touch target stays 44px.
// The menu, the keyboard and the label stay identical in both variants.
export function LocaleSwitcher({
  dropUp = false,
  variant = "default",
}: {
  dropUp?: boolean;
  variant?: "default" | "compact";
}) {
  const compact = variant === "compact";
  const { locale, setLocale, t } = useTranslation();
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listbox = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    listbox.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
    function dismissOutside(event: MouseEvent) {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== "Escape" || !wrapper.current?.contains(event.target as Node)) return;
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    }
    document.addEventListener("mousedown", dismissOutside);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("mousedown", dismissOutside);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);

  function choose(next: Locale) {
    setLocale(next);
    setOpen(false);
    trigger.current?.focus();
  }

  function moveFocus(event: ReactKeyboardEvent<HTMLButtonElement>) {
    const options = Array.from(listbox.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
    const current = options.indexOf(event.currentTarget);
    const jump: Record<string, number | undefined> = {
      ArrowDown: current + 1,
      ArrowUp: current - 1,
      Home: 0,
      End: options.length - 1,
    };
    const next = jump[event.key];
    if (next === undefined) return;
    event.preventDefault();
    options[(next + options.length) % options.length]?.focus();
  }

  return (
    <div ref={wrapper} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={t("footer.languageCurrent").replace("{language}", () => LOCALE_LABELS[locale])}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={
          compact
            ? "locale-switcher-compact grid size-11 shrink-0 place-items-center rounded-md bg-transparent text-[11px] font-semibold text-[var(--color-ink-soft)] transition-colors hover:bg-[var(--color-surface-soft)] hover:text-[var(--color-ink)]"
            : "inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-md border border-[var(--color-line)] bg-[var(--color-surface-soft)] px-2.5 text-[11px] font-bold tracking-[0.08em] text-[var(--color-ink)] transition-colors hover:border-[var(--color-line-strong)]"
        }
      >
        <span aria-hidden="true" className={compact ? "text-[11px] font-semibold tracking-normal" : undefined}>{LOCALE_SHORT_LABELS[locale]}</span>
        {compact ? null : (
          <ChevronDown
            aria-hidden="true"
            size={12}
            strokeWidth={1.8}
            className={`transition-transform duration-[var(--duration-base)] ease-[var(--ease-standard)] ${open ? "rotate-180" : ""}`}
          />
        )}
      </button>
      {open ? (
        <div
          ref={listbox}
          id={listId}
          role="listbox"
          aria-label={t("footer.language")}
          className={`motion-drop-in absolute right-0 z-[60] min-w-44 max-w-[calc(100vw-2rem)] rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-1.5 shadow-[var(--shadow-soft)] ${dropUp ? "bottom-full mb-2" : "top-full mt-2"}`}
        >
          {LOCALES.map((code) => {
            const selected = code === locale;
            return (
              <button
                key={code}
                type="button"
                role="option"
                lang={code}
                aria-selected={selected}
                tabIndex={-1}
                onClick={() => choose(code)}
                onKeyDown={moveFocus}
                className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-3 text-left text-sm font-semibold transition-colors hover:bg-[var(--color-surface-soft)] ${selected ? "text-[var(--color-primary)]" : "text-[var(--color-ink)]"}`}
              >
                {LOCALE_LABELS[code]}
                {selected ? <Check aria-hidden="true" size={16} strokeWidth={2.2} className="shrink-0" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
