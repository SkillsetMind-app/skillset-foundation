// Dictionary registry with every shipped locale loaded statically. For server
// code, tests, and the few client screens that search across all languages on
// purpose (the course marketplace and the help center). Anything that renders
// on every page imports ./translate instead, so the other locales stay out of
// the shared client bundle.

import esDict from "@/data/i18n/es.json";

import { DEFAULT_LOCALE, type Locale } from "./config";
import { englishDictionary, registerDictionary, translate, type Dictionary } from "./translate";

export { translate, type Dictionary };

const dictionaries: Record<Locale, Dictionary> = {
  en: englishDictionary,
  // Both shipped dictionaries must contain the same keys.
  es: esDict,
};

// Already in memory here, so the client provider need not fetch it again.
registerDictionary("es", esDict);

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale] ?? dictionaries[DEFAULT_LOCALE];
}
