import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { applyFlat } from "./flatten";
import {
  DEFAULT_LOCALE,
  getMessages,
  persistLocale,
  readStoredLocale,
  type Locale,
  type Messages,
} from "./index";
import { en } from "./messages/en";
import { loadPack } from "./packs";
import { isHandwritten } from "./uiLangs";

interface I18nContextValue {
  locale: Locale;
  messages: Messages;
  setLocale: (locale: Locale) => void;
  t: Messages;
  loading: boolean;
  catalogUnavailable: boolean;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  const [messages, setMessages] = useState<Messages>(() => getMessages(DEFAULT_LOCALE));
  const [loading, setLoading] = useState(false);
  const [catalogUnavailable, setCatalogUnavailable] = useState(false);
  const seq = useRef(0);

  const applyLocale = useCallback(async (next: Locale) => {
    const token = ++seq.current;
    if (isHandwritten(next)) {
      if (token !== seq.current) return;
      setMessages(getMessages(next));
      setLocaleState(next);
      setCatalogUnavailable(false);
      persistLocale(next);
      return;
    }
    setLoading(true);
    try {
      const flat = await loadPack(next);
      if (!flat) throw new Error("no pack");
      if (token !== seq.current) return;
      const hydrated = applyFlat(en, flat);
      setMessages(hydrated);
      setLocaleState(next);
      setCatalogUnavailable(false);
      persistLocale(next);
      document.title = hydrated.meta.title;
    } catch {
      /* pack chunk failed to load — keep previous pack, mark honestly */
      if (token === seq.current) setCatalogUnavailable(true);
    } finally {
      if (token === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void applyLocale(readStoredLocale());
  }, [applyLocale]);

  const setLocale = useCallback(
    (next: Locale) => {
      void applyLocale(next);
    },
    [applyLocale],
  );

  const value = useMemo(
    () => ({
      locale,
      messages,
      setLocale,
      t: messages,
      loading,
      catalogUnavailable,
    }),
    [locale, messages, setLocale, loading, catalogUnavailable],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within LocaleProvider");
  }
  return ctx;
}

export function useT(): Messages {
  return useI18n().t;
}

export function useLocale(): [Locale, (locale: Locale) => void] {
  const { locale, setLocale } = useI18n();
  return [locale, setLocale];
}
