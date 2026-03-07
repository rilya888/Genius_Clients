import type { SupportedLocale } from "./dictionaries";

const supportedLocales: SupportedLocale[] = ["it", "en"];
const supportedLocaleSet = new Set<SupportedLocale>(supportedLocales);

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === "string" && supportedLocaleSet.has(value as SupportedLocale);
}

export function resolveLocale(
  input: {
    requested?: string | null;
    tenantDefault?: string | null;
    fallback?: SupportedLocale;
  } = {}
): SupportedLocale {
  if (isSupportedLocale(input.requested)) {
    return input.requested;
  }

  if (isSupportedLocale(input.tenantDefault)) {
    return input.tenantDefault;
  }

  return input.fallback ?? "en";
}

export { supportedLocales };
