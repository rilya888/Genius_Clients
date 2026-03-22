import { ApiHttpError } from "./http";

export function formatApiError(error: unknown, fallbackMessage: string) {
  if (error instanceof ApiHttpError) {
    const reason = extractReason(error.details);
    if (reason === "email_verification_required_for_write_operations") {
      const detail = resolveEmailVerificationRequiredMessage();
      return error.requestId ? `${detail} (requestId: ${error.requestId})` : detail;
    }
    const detail = error.message.startsWith("HTTP_") ? fallbackMessage : error.message;
    return error.requestId ? `${detail} (requestId: ${error.requestId})` : detail;
  }
  return fallbackMessage;
}

function extractReason(details: unknown) {
  if (!details || typeof details !== "object") {
    return null;
  }
  const source = details as Record<string, unknown>;
  return typeof source.reason === "string" ? source.reason : null;
}

function resolveEmailVerificationRequiredMessage() {
  if (typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("it")) {
    return "Verifica la tua email per creare o modificare i dati.";
  }
  return "Please verify your email to create or edit data.";
}
