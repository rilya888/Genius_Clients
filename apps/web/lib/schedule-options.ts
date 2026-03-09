export type SelectOption = { value: string; label: string };

export const WEEKDAY_OPTIONS: SelectOption[] = [
  { value: "0", label: "Sunday" },
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" }
];

const BASE_TIME_OPTIONS: SelectOption[] = Array.from({ length: 24 * 4 }, (_, index) => {
  const minute = index * 15;
  const hours = Math.floor(minute / 60)
    .toString()
    .padStart(2, "0");
  const minutes = (minute % 60).toString().padStart(2, "0");
  return { value: String(minute), label: `${hours}:${minutes}` };
});

function minuteToLabel(minuteValue: string): string {
  const minute = Number(minuteValue);
  if (!Number.isFinite(minute) || minute < 0 || minute > 24 * 60) {
    return `Custom (${minuteValue})`;
  }
  const hours = Math.floor(minute / 60)
    .toString()
    .padStart(2, "0");
  const minutes = (minute % 60).toString().padStart(2, "0");
  return `${hours}:${minutes} (custom)`;
}

export function getTimeOptions(currentValue: string, includeEmpty = false): SelectOption[] {
  const options = [...BASE_TIME_OPTIONS];
  if (currentValue && !options.some((option) => option.value === currentValue)) {
    options.unshift({ value: currentValue, label: minuteToLabel(currentValue) });
  }
  if (includeEmpty) {
    options.unshift({ value: "", label: "Not set" });
  }
  return options;
}
