import { createContext, useContext, useMemo, useState, type PropsWithChildren } from "react";
import { dictionary, type Locale } from "./dictionary";

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function resolveInitialLocale(): Locale {
  const fromStorage = localStorage.getItem("ui_locale");
  if (fromStorage === "en" || fromStorage === "it") {
    return fromStorage;
  }

  return navigator.language.toLowerCase().startsWith("it") ? "it" : "en";
}

export function I18nProvider({ children }: PropsWithChildren) {
  const [locale, setLocale] = useState<Locale>(resolveInitialLocale);

  const value = useMemo<I18nContextValue>(() => {
    return {
      locale,
      setLocale: (nextLocale: Locale) => {
        localStorage.setItem("ui_locale", nextLocale);
        setLocale(nextLocale);
      },
      t: (key: string) => dictionary[locale][key] ?? dictionary.en[key] ?? key
    };
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used inside I18nProvider");
  }

  return ctx;
}
