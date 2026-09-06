"use client";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { isLocale, LOCALES, LOCALE_LABELS, LOCALE_SHORT_LABELS } from "@/lib/i18n/config";

export function LocaleSwitcher() {
  const { locale, setLocale, t } = useTranslation();

  return (
    <div className="relative inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-full border border-[var(--color-line)] bg-[var(--color-surface-soft)] px-2.5 text-[11px] font-bold tracking-[0.08em] text-[var(--color-ink)] focus-within:outline focus-within:outline-2 focus-within:outline-offset-[3px] focus-within:outline-[var(--color-primary)]">
      <span aria-hidden="true">{LOCALE_SHORT_LABELS[locale]}</span>
      <svg aria-hidden="true" viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="m3 4.5 3 3 3-3" />
      </svg>
      <select
        aria-label={t("footer.language")}
        value={locale}
        onChange={(event) => { if (isLocale(event.target.value)) setLocale(event.target.value); }}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      >
        {LOCALES.map((code) => <option key={code} value={code} lang={code}>{LOCALE_LABELS[code]}</option>)}
      </select>
    </div>
  );
}
