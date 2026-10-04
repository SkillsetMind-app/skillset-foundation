// Client-safe translator. Only English ships in the client bundle: it is the
// default locale, the source-of-truth shape and the fallback for any missing
// key. Every other dictionary is a separate chunk, loaded when a visitor
// actually picks that language (or sent by the server with the page when the
// cookie already asks for it). Shipping all of them statically put ~95 kB gz
// of Spanish on every page, for visitors who never see it.

import enDict from "@/data/i18n/en.json";

import { DEFAULT_LOCALE, type Locale } from "./config";

export type Dictionary = typeof enDict;

export const englishDictionary: Dictionary = enDict;

const loaded: Partial<Record<Locale, Dictionary>> = { [DEFAULT_LOCALE]: enDict };

const loaders: Partial<Record<Locale, () => Promise<{ default: unknown }>>> = {
  es: () => import("@/data/i18n/es.json"),
};

/** Make a dictionary available synchronously (server-sent, or already imported). */
export function registerDictionary(locale: Locale, dict: Dictionary): void {
  loaded[locale] = dict;
}

/** The dictionary for `locale` if it is already in memory, else undefined. */
export function getLoadedDictionary(locale: Locale): Dictionary | undefined {
  return loaded[locale];
}

/** Resolve the dictionary for `locale`, fetching its chunk the first time. */
export async function loadDictionary(locale: Locale): Promise<Dictionary> {
  const ready = loaded[locale];
  if (ready) {
    return ready;
  }
  const load = loaders[locale];
  if (!load) {
    return enDict;
  }
  const dict = (await load()).default as Dictionary;
  loaded[locale] = dict;
  return dict;
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

  const fallback = resolvePath(enDict, key);
  return typeof fallback === "string" ? fallback : key;
}
