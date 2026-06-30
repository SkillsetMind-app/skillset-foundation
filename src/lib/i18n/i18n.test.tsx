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
    expect(isLocale("pt-BR")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(normalizeLocale("es")).toBe("es");
    expect(normalizeLocale("xx")).toBe(DEFAULT_LOCALE);
    expect(normalizeLocale(undefined)).toBe(DEFAULT_LOCALE);
  });

  it("picks the best locale from Accept-Language", () => {
    expect(pickLocaleFromAcceptLanguage("pt-BR,pt;q=0.9,en;q=0.8")).toBe("pt-BR");
    expect(pickLocaleFromAcceptLanguage("es-ES,es;q=0.9")).toBe("es");
    expect(pickLocaleFromAcceptLanguage("en-US,en;q=0.9")).toBe("en");
    expect(pickLocaleFromAcceptLanguage("fr-FR")).toBe(DEFAULT_LOCALE);
    expect(pickLocaleFromAcceptLanguage(null)).toBe(DEFAULT_LOCALE);
  });
});

describe("i18n dictionaries", () => {
  it("translates known keys per locale", () => {
    expect(translate(getDictionary("en"), "nav.signIn")).toBe("Sign in");
    expect(translate(getDictionary("pt-BR"), "nav.signIn")).toBe("Entrar");
    expect(translate(getDictionary("es"), "nav.signIn")).toBe("Iniciar sesión");
  });

  it("falls back to the key itself when an entry is missing everywhere", () => {
    expect(translate(getDictionary("pt-BR"), "nav.doesNotExist")).toBe(
      "nav.doesNotExist",
    );
  });
});
