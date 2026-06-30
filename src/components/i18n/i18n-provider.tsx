"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_HTML_LANG,
  type Locale,
} from "@/lib/i18n/config";
import { getDictionary, translate } from "@/lib/i18n/dictionaries";

type I18nContextValue = {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: (key: string) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

/**
 * Holds the active locale for client components. `initialLocale` comes from the
 * server (cookie read in the root layout), so the first client render matches
 * SSR — no hydration mismatch. Changing the locale persists the cookie, syncs
 * <html lang>, and refreshes the route so server components (e.g. the footer)
 * re-render in the new language too.
 */
export function I18nProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = useCallback(
    (next: Locale) => {
      if (next === locale) {
        return;
      }
      setLocaleState(next);

      if (typeof document !== "undefined") {
        document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
        document.documentElement.lang = LOCALE_HTML_LANG[next];
      }

      // Re-render server components with the new cookie. Client state already
      // updated above, so client + server converge on the same locale.
      router.refresh();
    },
    [locale, router],
  );

  const value = useMemo<I18nContextValue>(() => {
    const dict = getDictionary(locale);
    return { locale, setLocale, t: (key: string) => translate(dict, key) };
  }, [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * Read translations in a client component. Falls back to English (rather than
 * throwing) when used outside the provider, so isolated components and tests
 * still render.
 */
export function useTranslation(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (ctx) {
    return ctx;
  }

  const dict = getDictionary(DEFAULT_LOCALE);
  return {
    locale: DEFAULT_LOCALE,
    setLocale: () => {},
    t: (key: string) => translate(dict, key),
  };
}
