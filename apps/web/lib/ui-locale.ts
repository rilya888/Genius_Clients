import { resolveLocale, type SupportedLocale } from "@genius/i18n";

export const UI_LOCALE_COOKIE = "gc_locale";

export function parseLocaleCookie(cookieHeader: string | null | undefined): SupportedLocale | null {
  if (!cookieHeader) {
    return null;
  }

  const parts = cookieHeader.split(";").map((part) => part.trim());
  const match = parts.find((part) => part.startsWith(`${UI_LOCALE_COOKIE}=`));
  if (!match) {
    return null;
  }

  const raw = decodeURIComponent(match.slice(`${UI_LOCALE_COOKIE}=`.length));
  return resolveLocale({ requested: raw, fallback: "it" });
}

export function getBrowserLocale(): SupportedLocale {
  if (typeof window === "undefined") {
    return "it";
  }
  return resolveLocale({ requested: window.navigator.language.toLowerCase(), fallback: "it" });
}

export function setUiLocaleCookie(locale: SupportedLocale): void {
  if (typeof document === "undefined") {
    return;
  }
  const maxAgeSeconds = 60 * 60 * 24 * 365;
  document.cookie = `${UI_LOCALE_COOKIE}=${encodeURIComponent(locale)}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax`;
}

