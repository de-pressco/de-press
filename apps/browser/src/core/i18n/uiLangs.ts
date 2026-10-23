export const HANDWRITTEN = new Set(["ru", "en"]);

export const RTL_LANGS = new Set(["ar", "he", "fa", "ur"]);

/** Picker codes — en, es, ru lead, then the rest. Every code ships a pack. */
export const UI_LANGS: string[] = [
  "en",
  "es",
  "ru",
  "uk",
  "be",
  "kk",
  "uz",
  "hy",
  "ka",
  "az",
  "tg",
  "de",
  "fr",
  "pt",
  "it",
  "nl",
  "pl",
  "cs",
  "sk",
  "hu",
  "ro",
  "bg",
  "el",
  "tr",
  "sv",
  "da",
  "fi",
  "no",
  "ar",
  "he",
  "fa",
  "ur",
  "hi",
  "bn",
  "id",
  "vi",
  "th",
  "ja",
  "ko",
  "zh",
  "sw",
];

export function isUiLang(code: string): boolean {
  return UI_LANGS.includes(code);
}

export function isHandwritten(code: string): boolean {
  return HANDWRITTEN.has(code);
}

export function isRtl(code: string): boolean {
  const base = code.split("-")[0] ?? code;
  return RTL_LANGS.has(base);
}

export function langLabel(code: string, displayLocale = "en"): string {
  try {
    const names = new Intl.DisplayNames([displayLocale], { type: "language" });
    return names.of(code) || code;
  } catch {
    return code;
  }
}
