// Server-only locale helpers. The next/headers import below makes this module
// server-only at runtime (importing it from a client component throws), so it
// must never be pulled into a client bundle — client code uses the
// I18nProvider instead.

import { cookies } from "next/headers";

import { LOCALE_COOKIE, normalizeLocale, type Locale } from "./config";
import { getDictionary, translate } from "./dictionaries";

/**
 * Resolve the request locale from the cookie the client switcher writes.
 *
 * This was hard-pinned to English through launch, on the grounds that the
 * primary surfaces were not fully localized. That is no longer true: es.json
 * mirrors en.json key-for-key (543/543) and 387 distinct keys are consumed
 * across 44 files — the marketing site, auth, the platform shell, and both
 * dashboards. Deep creator tooling is still English-only, so a Spanish session
 * is good-not-perfect; that is why this stays strictly opt-in.
 *
 * Only an explicit cookie changes anything. No cookie (every visitor today)
 * still resolves to English, and normalizeLocale() sends an unrecognized value
 * — including the archived pt-BR — back to English rather than half-rendering
 * a locale we no longer ship.
 *
 * ponytail: cookie only. pickLocaleFromAcceptLanguage() is written and tested
 * for the day we want a Spanish browser to land in Spanish unprompted, but
 * that flips the language for existing traffic without anyone asking. Wire it
 * here when that is a deliberate product call.
 */
export async function getServerLocale(): Promise<Locale> {
  const store = await cookies();
  return normalizeLocale(store.get(LOCALE_COOKIE)?.value);
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
