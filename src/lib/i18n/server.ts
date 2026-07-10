// Server-only locale helpers. The next/headers import below makes this module
// server-only at runtime (importing it from a client component throws), so it
// must never be pulled into a client bundle — client code uses the
// I18nProvider instead.

import { cookies } from "next/headers";

import { DEFAULT_LOCALE, type Locale } from "./config";
import { getDictionary, translate } from "./dictionaries";

/**
 * Resolve the request locale. Launch is intentionally EN-only until the
 * remaining primary surfaces are fully localized; historical non-English
 * cookies are ignored so SSR never promises a partial PT/ES experience.
 */
export async function getServerLocale(): Promise<Locale> {
  await cookies();
  return DEFAULT_LOCALE;
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
