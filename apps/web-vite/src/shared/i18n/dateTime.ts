function parseInput(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date(0);
  }
  return date;
}

function getParts(value: Date | string, timezone?: string) {
  const date = parseInput(value);
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

export function formatUiDate(value: Date | string, timezone?: string): string {
  const parts = getParts(value, timezone);
  return `${parts.day}.${parts.month}.${parts.year}`;
}

export function formatUiTime(value: Date | string, timezone?: string): string {
  const parts = getParts(value, timezone);
  return `${parts.hour}:${parts.minute}`;
}

export function formatUiDateTime(value: Date | string, timezone?: string): string {
  const parts = getParts(value, timezone);
  return `${parts.day}.${parts.month}.${parts.year} ${parts.hour}:${parts.minute}`;
}

