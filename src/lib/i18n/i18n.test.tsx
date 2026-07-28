import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOCALE,
  isLocale,
  normalizeLocale,
  pickLocaleFromAcceptLanguage,
} from "./config";
import { getDictionary, translate } from "./dictionaries";

describe("i18n config", () => {
  it("guards and normalizes locales", () => {
    expect(isLocale("es")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    // pt-BR is archived for the US-first launch, so it must not be a locale.
    expect(isLocale("pt-BR")).toBe(false);
    expect(normalizeLocale("es")).toBe("es");
    expect(normalizeLocale("pt-BR")).toBe(DEFAULT_LOCALE);
    expect(normalizeLocale("xx")).toBe(DEFAULT_LOCALE);
    expect(normalizeLocale(undefined)).toBe(DEFAULT_LOCALE);
  });

  it("picks the best locale from Accept-Language", () => {
    expect(pickLocaleFromAcceptLanguage("es-ES,es;q=0.9")).toBe("es");
    expect(pickLocaleFromAcceptLanguage("en-US,en;q=0.9")).toBe("en");
    expect(pickLocaleFromAcceptLanguage("fr-FR")).toBe(DEFAULT_LOCALE);
    expect(pickLocaleFromAcceptLanguage(null)).toBe(DEFAULT_LOCALE);
  });

  it("falls through pt-* to the next supported tag, then to English", () => {
    expect(pickLocaleFromAcceptLanguage("pt-BR,pt;q=0.9,en;q=0.8")).toBe("en");
    expect(pickLocaleFromAcceptLanguage("pt-BR,pt;q=0.9,es;q=0.8")).toBe("es");
    expect(pickLocaleFromAcceptLanguage("pt-BR")).toBe(DEFAULT_LOCALE);
  });
});

describe("i18n dictionaries", () => {
  it("translates known keys per locale", () => {
    expect(translate(getDictionary("en"), "nav.signIn")).toBe("Sign in");
    expect(translate(getDictionary("es"), "nav.signIn")).toBe("Iniciar sesión");
  });

  it("falls back to the key itself when an entry is missing everywhere", () => {
    expect(translate(getDictionary("es"), "nav.doesNotExist")).toBe(
      "nav.doesNotExist",
    );
  });
});
