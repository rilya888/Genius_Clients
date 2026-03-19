export function maskPhone(value: string): string {
  const raw = value.trim();
  if (!raw) {
    return raw;
  }
  const normalized = raw.replace(/\s+/g, "");
  if (normalized.length <= 4) {
    return "***";
  }
  return `${normalized.slice(0, 3)}***${normalized.slice(-2)}`;
}

export function redactLogString(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._-]+\b/gi, "Bearer [redacted]")
    .replace(/\b(EA[A-Za-z0-9]+)\b/g, "[redacted_token]")
    .replace(/\bgh[opus]_[A-Za-z0-9_]+\b/g, "[redacted_token]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted_email]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, "[redacted_id]")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, "[redacted_phone]");
}

export function maskIdentifier(value: string): string {
  const normalized = value.trim();
  if (normalized.length <= 8) {
    return "[id]";
  }
  return `${normalized.slice(0, 4)}...${normalized.slice(-4)}`;
}

export function toLogError(error: unknown): string {
  if (error instanceof Error) {
    return redactLogString(error.message).slice(0, 300);
  }
  return redactLogString(String(error)).slice(0, 300);
}

export function sanitizeHandoffSummary(value: string) {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, "[phone]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

export function sanitizeAlertContext(context: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (typeof value === "string") {
      out[key] = redactLogString(value).slice(0, 300);
      continue;
    }
    if (
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null ||
      value === undefined
    ) {
      out[key] = value;
      continue;
    }
    try {
      out[key] = redactLogString(JSON.stringify(value)).slice(0, 300);
    } catch {
      out[key] = "[unserializable]";
    }
  }
  return out;
}
