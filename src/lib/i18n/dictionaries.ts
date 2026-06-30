// Dictionary registry + translator. Pure module (no server/client APIs) so both
// sides can resolve strings. English is the source-of-truth shape and the
// fallback for any key a translation is missing.

import enDict from "@/data/i18n/en.json";
import esDict from "@/data/i18n/es.json";
import ptBrDict from "@/data/i18n/pt-br.json";

import { DEFAULT_LOCALE, type Locale } from "./config";

export type Dictionary = typeof enDict;

const dictionaries: Record<Locale, Dictionary> = {
  en: enDict,
  // pt-BR/es mirror en's shape; the cast tolerates any key still untranslated,
  // and translate() falls back to English at runtime for those.
  "pt-BR": ptBrDict as Dictionary,
  es: esDict as Dictionary,
};

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale] ?? dictionaries[DEFAULT_LOCALE];
}

function resolvePath(source: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((acc, part) => {
    if (acc && typeof acc === "object" && part in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, source);
}

/**
 * Resolve a dot-path key against a dictionary. Falls back to English when the
 * key is missing/untranslated, then to the key itself so a typo is visible
 * rather than rendering an empty string.
 */
export function translate(dict: Dictionary, key: string): string {
  const value = resolvePath(dict, key);
  if (typeof value === "string") {
    return value;
  }

  const fallback = resolvePath(dictionaries[DEFAULT_LOCALE], key);
  return typeof fallback === "string" ? fallback : key;
}
