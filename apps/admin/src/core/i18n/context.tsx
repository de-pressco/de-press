import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { en } from "./messages/en";
import { ru } from "./messages/ru";
import type { Lang, Messages } from "./types";

export type { Lang, Messages };

const MESSAGES: Record<Lang, Messages> = { en, ru };

interface I18nContextValue {
  lang: Lang;
  t: Messages;
  setLang: (lang: Lang) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");
  const setLang = useCallback((next: Lang) => setLangState(next), []);
  const value = useMemo<I18nContextValue>(
    () => ({ lang, t: MESSAGES[lang], setLang }),
    [lang, setLang],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
