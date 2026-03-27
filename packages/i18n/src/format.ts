import type { SupportedLocale } from "./dictionaries";

function localeTag(locale: SupportedLocale): string {
  return locale === "it" ? "it-IT" : "en-GB";
}

function getDateTimeParts(input: Date | string, timezone?: string) {
  const date = typeof input === "string" ? new Date(input) : input;
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone
  }).formatToParts(date);
  const map = new Map(parts.map((part) => [part.type, part.value]));
  return {
    day: map.get("day") ?? "01",
    month: map.get("month") ?? "01",
    year: map.get("year") ?? "1970",
    hour: map.get("hour") ?? "00",
    minute: map.get("minute") ?? "00"
  };
}

export function formatDate(input: Date | string, options: { locale: SupportedLocale; timezone?: string }) {
  const parts = getDateTimeParts(input, options.timezone);
  return `${parts.day}.${parts.month}.${parts.year}`;
}

export function formatTime(input: Date | string, options: { locale: SupportedLocale; timezone?: string }) {
  const parts = getDateTimeParts(input, options.timezone);
  return `${parts.hour}:${parts.minute}`;
}

export function formatDateTime(input: Date | string, options: { locale: SupportedLocale; timezone?: string }) {
  const parts = getDateTimeParts(input, options.timezone);
  return `${parts.day}.${parts.month}.${parts.year} ${parts.hour}:${parts.minute}`;
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
