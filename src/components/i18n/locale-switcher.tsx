"use client";

import { Globe } from "lucide-react";

import { useTranslation } from "@/components/i18n/i18n-provider";
import { isLocale, LOCALE_LABELS, LOCALES } from "@/lib/i18n/config";

/**
 * Language switcher. A native <select> — accessible and keyboard-friendly with
 * zero dropdown JS (ponytail: native platform feature over a picker lib).
 * Changing it persists the cookie + refreshes server components via the
 * provider's setLocale.
 */
export function LocaleSwitcher({ className }: { className?: string }) {
  const { locale, setLocale, t } = useTranslation();

  return (
    <label
      className={`inline-flex items-center gap-2 text-xs font-semibold text-[var(--color-ink-soft)] ${className ?? ""}`}
    >
      <Globe aria-hidden="true" size={14} strokeWidth={1.9} />
      <span className="sr-only">{t("locale.label")}</span>
      <select
        value={locale}
        onChange={(event) => {
          const next = event.target.value;
          if (isLocale(next)) {
            setLocale(next);
          }
        }}
        aria-label={t("locale.label")}
        className="cursor-pointer rounded-[8px] border border-[var(--color-line)] bg-white px-2 py-1.5 text-xs font-semibold text-[var(--color-ink)] outline-none transition-colors hover:border-[var(--color-primary-light)] focus-visible:border-[var(--color-primary-light)]"
      >
        {LOCALES.map((option) => (
          <option key={option} value={option}>
            {LOCALE_LABELS[option]}
          </option>
        ))}
      </select>
    </label>
  );
}
