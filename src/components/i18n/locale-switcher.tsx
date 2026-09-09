"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { LOCALES, LOCALE_LABELS, LOCALE_SHORT_LABELS, type Locale } from "@/lib/i18n/config";

// Menu próprio em vez de <select>: o popup nativo é desenhado pelo navegador e
// não aceita CSS ("parece uma listinha crua", 07/09). Abre e fecha como os
// outros menus do site (public-entry-menu, kebab do studio): clique fora fecha,
// Escape fecha e devolve o foco ao gatilho. Cada opção é um <button> nativo,
// então Enter/Espaço escolhem sozinhos e o anel de foco global já cobre;
// ↑/↓/Home/End andam pela lista. `dropUp` é para o rodapé, onde abrir para
// baixo cairia fora da página. Sem fechar no blur de propósito: no Safari o
// clique não foca o botão, e o blur fecharia o menu antes do click da opção.
//
// `variant="compact"` é para dentro de uma barra de ícones (topo da plataforma,
// barra do site): sigla sem moldura permanente; alvo de toque permanece 44px.
// O menu, o teclado e o rótulo continuam idênticos nas duas variantes.
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
            : "inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-full border border-[var(--color-line)] bg-[var(--color-surface-soft)] px-2.5 text-[11px] font-bold tracking-[0.08em] text-[var(--color-ink)] transition-colors hover:border-[var(--color-line-strong)]"
        }
      >
        <span aria-hidden="true">{LOCALE_SHORT_LABELS[locale]}</span>
        {compact ? null : (
          <ChevronDown
            aria-hidden="true"
            size={12}
            strokeWidth={1.8}
            className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          />
        )}
      </button>
      {open ? (
        <div
          ref={listbox}
          id={listId}
          role="listbox"
          aria-label={t("footer.language")}
          className={`absolute right-0 z-[60] min-w-44 max-w-[calc(100vw-2rem)] rounded-[10px] border border-[var(--color-line)] bg-[var(--color-surface)] p-1.5 shadow-[var(--shadow-soft)] ${dropUp ? "bottom-full mb-2" : "top-full mt-2"}`}
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
                className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-[8px] px-3 text-left text-sm font-semibold transition-colors hover:bg-[var(--color-surface-soft)] ${selected ? "text-[var(--color-primary)]" : "text-[var(--color-ink)]"}`}
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
