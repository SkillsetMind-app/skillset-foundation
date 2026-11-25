// Languages the teacher can choose for the caption (the one spoken in the lesson and the
// translations). ISO 639-1 codes: Whisper and Bunny use the same ones.
// ponytail: short, fixed list of the most spoken languages; grow it when a
// teacher asks for one that is missing. The name comes from Intl, with no translation key.
export const CAPTION_LANGUAGES = [
  "en", "es", "pt", "fr", "de", "it", "nl", "pl", "ru", "uk",
  "tr", "ar", "hi", "zh", "ja", "ko", "id", "vi", "tl", "sv",
] as const;

export type CaptionLanguage = (typeof CAPTION_LANGUAGES)[number];

export function isCaptionLanguage(value: unknown): value is CaptionLanguage {
  return typeof value === "string" && (CAPTION_LANGUAGES as readonly string[]).includes(value);
}

/** Name of the language in the interface language ("Spanish" / "español"). */
export function captionLanguageName(code: string, uiLocale = "en"): string {
  try {
    return new Intl.DisplayNames([uiLocale], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}
