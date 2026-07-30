# Archived locales

Dictionaries removed from the runtime bundle but kept under version control so a
future release can restore them without re-translating 537 keys.

| File | Removed | Why |
|---|---|---|
| `pt-br.json` | 2026-07-28 | US-first launch. Brazil is a later release. |

## Why they were dead before removal

`src/lib/i18n/server.ts` → `getServerLocale()` returns `DEFAULT_LOCALE`
unconditionally, and the client `I18nProvider` receives its locale from the
server. No request could ever resolve to pt-BR, so the dictionary was parsed and
bundled on every build and never read.

## Restoring pt-BR

1. `git mv docs/i18n-archive/pt-br.json src/data/i18n/pt-br.json`
2. `src/lib/i18n/config.ts` — add `"pt-BR"` to `LOCALES`, and add its entry to
   `LOCALE_LABELS` (`Português (Brasil)`), `LOCALE_SHORT_LABELS` (`PT`), and
   `LOCALE_HTML_LANG` (`pt-BR`).
3. `src/lib/i18n/config.ts` — in `pickLocaleFromAcceptLanguage()`, restore the
   `pt` branch **above** the `es` branch:
   ```ts
   if (tag === "pt-br" || tag.startsWith("pt")) {
     return "pt-BR";
   }
   ```
4. `src/lib/i18n/dictionaries.ts` — restore the import and the map entry.
5. `src/lib/i18n/i18n.test.tsx` — flip the guards back (`isLocale("pt-BR")` to
   `true`, drop the pt-fallthrough test).
6. Make `getServerLocale()` actually read the locale cookie — otherwise the
   dictionary is dead again the moment it lands.

Step 6 is the one that matters. Steps 1–5 only make pt-BR *selectable*; without
6 nothing selects it.

## Before shipping to Brazil

The dictionary is a snapshot of the pre-direct-charges copy. Anything the
direct-charges pivot rewrote in English — custody, settlement, payouts, "we
never hold your money", merchant of record — is **stale in pt-br.json** and must
be re-translated against the current `en.json`, not restored as-is.
