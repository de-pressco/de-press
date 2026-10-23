import { en } from "./messages/en";
import { ru } from "./messages/ru";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_STORAGE_KEY,
  LOCALES,
  type Locale,
  type Messages,
} from "./types";
import { isRtl, isUiLang } from "./uiLangs";

export type { Locale, Messages };
export {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_STORAGE_KEY,
  LOCALES,
};
export { fmt } from "./flatten";

const catalogs: Record<"ru" | "en", Messages> = { ru, en };

export function isHandwrittenLocale(
  value: string | null | undefined,
): value is "ru" | "en" {
  return value === "ru" || value === "en";
}

export function isLocale(value: string | null | undefined): value is Locale {
  if (!value) return false;
  return isUiLang(value) || isUiLang(value.split("-")[0] ?? "");
}

/** Handwritten catalogs only; machine locales start from `en` + a pack. */
export function getMessages(locale: Locale): Messages {
  return locale === "ru" ? catalogs.ru : catalogs.en;
}

export function resolveUiLang(raw: string | null | undefined): Locale | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (isUiLang(lower)) return lower;
  const base = lower.split("-")[0] ?? "";
  if (isUiLang(base)) return base;
  return null;
}

export function readStoredLocale(): Locale {
  try {
    const fromStorage = resolveUiLang(
      window.localStorage.getItem(LOCALE_STORAGE_KEY),
    );
    if (fromStorage) return fromStorage;
  } catch {
    /* ignore */
  }
  const match = document.cookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${LOCALE_COOKIE}=`));
  if (match) {
    const value = match.split("=")[1];
    const fromCookie = resolveUiLang(value);
    if (fromCookie) return fromCookie;
  }
  // Mini App: Telegram language_code when no stored preference
  try {
    const tgLang =
      window.Telegram?.WebApp?.initDataUnsafe?.user?.language_code?.toLowerCase() ??
      "";
    const fromTg = resolveUiLang(tgLang);
    if (fromTg) return fromTg;
  } catch {
    /* ignore */
  }
  const fromNav = resolveUiLang(navigator.language);
  if (fromNav) return fromNav;
  return DEFAULT_LOCALE;
}

export function persistLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    /* ignore */
  }
  const maxAge = 60 * 60 * 24 * 365;
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${maxAge}; samesite=lax`;
  document.documentElement.lang = locale;
  document.documentElement.dir = isRtl(locale) ? "rtl" : "ltr";
  const pack = isHandwrittenLocale(locale) ? getMessages(locale) : getMessages("en");
  document.title = pack.meta.title;
}
