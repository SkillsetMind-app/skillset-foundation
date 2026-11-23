// Idiomas que o professor pode escolher para a legenda (a falada na aula e as
// traduções). Códigos ISO 639-1: o Whisper e a Bunny usam os mesmos.
// ponytail: lista curta e fixa dos idiomas mais falados; aumente quando um
// professor pedir um que falta. O nome sai do Intl, sem chave de tradução.
export const CAPTION_LANGUAGES = [
  "en", "es", "pt", "fr", "de", "it", "nl", "pl", "ru", "uk",
  "tr", "ar", "hi", "zh", "ja", "ko", "id", "vi", "tl", "sv",
] as const;

export type CaptionLanguage = (typeof CAPTION_LANGUAGES)[number];

export function isCaptionLanguage(value: unknown): value is CaptionLanguage {
  return typeof value === "string" && (CAPTION_LANGUAGES as readonly string[]).includes(value);
}

/** Nome do idioma no idioma da interface ("Spanish" / "español"). */
export function captionLanguageName(code: string, uiLocale = "en"): string {
  try {
    return new Intl.DisplayNames([uiLocale], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}
