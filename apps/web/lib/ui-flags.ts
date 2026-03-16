function parseBoolean(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function isUiV2Enabled(): boolean {
  return parseBoolean(process.env.NEXT_PUBLIC_UI_V2_ENABLED) || parseBoolean(process.env.NEXT_PUBLIC_UI_V3_ENABLED);
}

export function isUiV3Enabled(): boolean {
  return parseBoolean(process.env.NEXT_PUBLIC_UI_V3_ENABLED);
}
