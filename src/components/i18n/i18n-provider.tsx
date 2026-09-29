"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_HTML_LANG,
  type Locale,
} from "@/lib/i18n/config";
import {
  englishDictionary,
  getLoadedDictionary,
  loadDictionary,
  registerDictionary,
  translate,
  type Dictionary,
} from "@/lib/i18n/translate";

type I18nContextValue = {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: (key: string) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

/**
 * Holds the active locale for client components. `initialLocale` comes from the
 * server (cookie read in the root layout), so the first client render matches
 * SSR — no hydration mismatch. For a non-English locale the layout also sends
 * `initialDictionary`, because only English is in the client bundle. Changing
 * the locale persists the cookie, syncs <html lang>, and refreshes the route so
 * server components (e.g. the footer) re-render in the new language too.
 */
export function I18nProvider({
  initialLocale,
  initialDictionary,
  children,
}: {
  initialLocale: Locale;
  initialDictionary?: Dictionary;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [state, setState] = useState<{ locale: Locale; dict: Dictionary }>(() => {
    if (initialDictionary) {
      registerDictionary(initialLocale, initialDictionary);
    }
    return {
      locale: initialLocale,
      dict: getLoadedDictionary(initialLocale) ?? englishDictionary,
    };
  });
  const { locale, dict } = state;
  // Last locale asked for, so a slow chunk cannot override a later choice.
  const requested = useRef(locale);

  // Only reachable without a server-sent dictionary (never in the app): fetch
  // it rather than staying on the English fallback.
  useEffect(() => {
    if (getLoadedDictionary(locale)) {
      return;
    }
    let live = true;
    void loadDictionary(locale).then((loaded) => {
      if (live) setState((current) => (current.locale === locale ? { locale, dict: loaded } : current));
    });
    return () => {
      live = false;
    };
  }, [locale]);

  const setLocale = useCallback(
    (next: Locale) => {
      if (next === requested.current) {
        return;
      }
      requested.current = next;

      const persist = () => {
        if (typeof document !== "undefined") {
          document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
          document.documentElement.lang = LOCALE_HTML_LANG[next];
        }
      };
      const apply = (nextDict: Dictionary) => {
        if (requested.current !== next) {
          return;
        }
        setState({ locale: next, dict: nextDict });
        persist();
        // Re-render server components with the new cookie. Client state already
        // updated above, so client + server converge on the same locale.
        router.refresh();
      };

      const ready = getLoadedDictionary(next);
      if (ready) {
        apply(ready);
        return;
      }
      loadDictionary(next).then(apply, () => {
        // Chunk failed to load (offline, stale deploy): keep the choice and let
        // a full reload bring the dictionary with the page.
        if (requested.current !== next) return;
        persist();
        window.location.reload();
      });
    },
    [router],
  );

  const value = useMemo<I18nContextValue>(
    () => ({ locale, setLocale, t: (key: string) => translate(dict, key) }),
    [locale, dict, setLocale],
  );

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

  return {
    locale: DEFAULT_LOCALE,
    setLocale: () => {},
    t: (key: string) => translate(englishDictionary, key),
  };
}
