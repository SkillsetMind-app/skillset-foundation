"use client";

import { useTranslation } from "@/components/i18n/i18n-provider";
import {
  LOCALES,
  LOCALE_LABELS,
  LOCALE_SHORT_LABELS,
} from "@/lib/i18n/config";

/**
 * Segmented EN | ES chip. The provider already owns the whole switch — it
 * writes the cookie, updates <html lang>, and calls router.refresh() so the
 * server components re-render in the new locale — so this is presentation only.
 *
 * ponytail: a plain button per locale rather than a <select>. Two options do
 * not need a popup, and LOCALES.map() takes a third locale without a rewrite.
 * The ::before pad stretches each button's hit area to 44px tall while the
 * chip itself stays compact enough for the header.
 */
export function LocaleSwitcher() {
  const { locale, setLocale, t } = useTranslation();

  return (
    <div
      role="group"
      aria-label={t("footer.language")}
      className="inline-flex items-center gap-0.5 rounded-full border border-[var(--color-line)] bg-[var(--color-surface-soft)] p-0.5"
    >
      {LOCALES.map((code) => {
        const active = code === locale;
        return (
          <button
            key={code}
            type="button"
            onClick={() => setLocale(code)}
            aria-pressed={active}
            title={LOCALE_LABELS[code]}
            className={`relative rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] transition-colors before:absolute before:inset-x-0 before:-inset-y-2.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-[var(--color-primary)] ${
              active
                ? "bg-white text-[var(--color-ink)] shadow-[var(--shadow-soft)]"
                : "text-[var(--color-ink-soft)] hover:text-[var(--color-primary)]"
            }`}
          >
            <span className="sr-only">{LOCALE_LABELS[code]}</span>
            <span aria-hidden="true">{LOCALE_SHORT_LABELS[code]}</span>
          </button>
        );
      })}
    </div>
  );
}
