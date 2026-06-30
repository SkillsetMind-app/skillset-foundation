// Locale configuration shared by server and client. Pure module — no
// next/headers, no `document` — so both the RSC layout and the client provider
// can import it safely.
//
// Design choice: NO `[locale]` route segments. The active locale lives in a
// cookie so every existing route keeps working; the server reads it to set
// `<html lang>` + the initial dictionary, and the client switcher writes it.

export const LOCALES = ["en", "pt-BR", "es"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

// Bump the version suffix if the locale set or cookie semantics change.
export const LOCALE_COOKIE = "skillset.locale.v1";
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

/** Full names for the switcher. */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  "pt-BR": "Português (Brasil)",
  es: "Español",
};

/** Compact labels for tight switchers (e.g. the footer chip). */
export const LOCALE_SHORT_LABELS: Record<Locale, string> = {
  en: "EN",
  "pt-BR": "PT",
  es: "ES",
};

/** BCP-47 value for the <html lang> attribute. */
export const LOCALE_HTML_LANG: Record<Locale, string> = {
  en: "en",
  "pt-BR": "pt-BR",
  es: "es",
};

export function isLocale(value: string | null | undefined): value is Locale {
  return value != null && (LOCALES as readonly string[]).includes(value);
}

export function normalizeLocale(value: string | null | undefined): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/**
 * Best supported locale from an Accept-Language header. Used only when no
 * explicit cookie choice exists yet, so a first-time pt/es visitor still lands
 * in their language. Matches by primary subtag (pt-* → pt-BR, es-* → es).
 */
export function pickLocaleFromAcceptLanguage(
  header: string | null | undefined,
): Locale {
  if (!header) {
    return DEFAULT_LOCALE;
  }

  const tags = header
    .split(",")
    .map((part) => part.split(";")[0]?.trim().toLowerCase())
    .filter(Boolean) as string[];

  for (const tag of tags) {
    if (tag === "pt-br" || tag.startsWith("pt")) {
      return "pt-BR";
    }
    if (tag.startsWith("es")) {
      return "es";
    }
    if (tag.startsWith("en")) {
      return "en";
    }
  }

  return DEFAULT_LOCALE;
}
