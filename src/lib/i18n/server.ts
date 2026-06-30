// Server-only locale helpers. The next/headers import below makes this module
// server-only at runtime (importing it from a client component throws), so it
// must never be pulled into a client bundle — client code uses the
// I18nProvider instead.

import { cookies, headers } from "next/headers";

import {
  LOCALE_COOKIE,
  normalizeLocale,
  pickLocaleFromAcceptLanguage,
  type Locale,
} from "./config";
import { getDictionary, translate } from "./dictionaries";

/**
 * Resolve the request's locale: an explicit cookie choice wins; otherwise fall
 * back to the browser's Accept-Language so a first-time visitor still lands in
 * their language. Read in the root layout to set <html lang> and seed the
 * client provider (keeping SSR and the first client render in sync).
 */
export async function getServerLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const fromCookie = cookieStore.get(LOCALE_COOKIE)?.value;
  if (fromCookie) {
    return normalizeLocale(fromCookie);
  }

  const headerStore = await headers();
  return pickLocaleFromAcceptLanguage(headerStore.get("accept-language"));
}

/** Locale-bound translator for server components: `const { t } = await getServerTranslation()`. */
export async function getServerTranslation(): Promise<{
  locale: Locale;
  t: (key: string) => string;
}> {
  const locale = await getServerLocale();
  const dict = getDictionary(locale);
  return { locale, t: (key: string) => translate(dict, key) };
}
