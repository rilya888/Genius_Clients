import { dictionaries, type SupportedLocale } from "./dictionaries";

type TranslateOptions = {
  locale: SupportedLocale;
  tenantDefaultLocale?: SupportedLocale;
  params?: Record<string, string | number>;
};

function interpolate(template: string, params?: Record<string, string | number>) {
  if (!params) {
    return template;
  }

  let value = template;
  for (const [key, raw] of Object.entries(params)) {
    value = value.replaceAll(`{${key}}`, String(raw));
  }
  return value;
}

export function t(key: string, options: TranslateOptions): string {
  const localeDict = dictionaries[options.locale];
  const fallbackDict = dictionaries[options.tenantDefaultLocale ?? "en"];
  const text = localeDict[key] ?? fallbackDict[key] ?? dictionaries.en[key] ?? key;
  return interpolate(text, options.params);
}
