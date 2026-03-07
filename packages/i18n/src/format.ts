import type { SupportedLocale } from "./dictionaries";

function localeTag(locale: SupportedLocale): string {
  return locale === "it" ? "it-IT" : "en-US";
}

export function formatDate(input: Date | string, options: { locale: SupportedLocale; timezone?: string }) {
  const date = typeof input === "string" ? new Date(input) : input;
  return new Intl.DateTimeFormat(localeTag(options.locale), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: options.timezone
  }).format(date);
}

export function formatTime(input: Date | string, options: { locale: SupportedLocale; timezone?: string }) {
  const date = typeof input === "string" ? new Date(input) : input;
  return new Intl.DateTimeFormat(localeTag(options.locale), {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: options.timezone
  }).format(date);
}

export function formatDateTime(input: Date | string, options: { locale: SupportedLocale; timezone?: string }) {
  const date = typeof input === "string" ? new Date(input) : input;
  return new Intl.DateTimeFormat(localeTag(options.locale), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: options.timezone
  }).format(date);
}

export function formatCurrency(
  cents: number,
  options: { locale: SupportedLocale; currency?: string } = { locale: "en" }
) {
  return new Intl.NumberFormat(localeTag(options.locale), {
    style: "currency",
    currency: options.currency ?? "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(cents / 100);
}
