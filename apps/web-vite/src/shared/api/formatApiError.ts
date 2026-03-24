import { ApiHttpError } from "./http";

export function formatApiError(error: unknown, fallbackMessage: string) {
  if (error instanceof ApiHttpError) {
    const reason = extractReason(error.details);
    if (reason === "email_verification_required_for_write_operations") {
      const detail = resolveEmailVerificationRequiredMessage();
      return error.requestId ? `${detail} (requestId: ${error.requestId})` : detail;
    }
    if (reason === "desired_whatsapp_bot_e164_invalid") {
      return withRequestId(resolveLocalizedMessage("Enter a valid WhatsApp bot number in international format."), error.requestId);
    }
    if (reason === "operator_whatsapp_e164_invalid") {
      return withRequestId(resolveLocalizedMessage("Enter a valid operator WhatsApp number in international format."), error.requestId);
    }
    if (reason === "whatsapp_numbers_must_be_different") {
      return withRequestId(resolveLocalizedMessage("Bot number and operator number must be different."), error.requestId);
    }
    if (reason === "desired_whatsapp_bot_e164_conflict") {
      return withRequestId(resolveLocalizedMessage("This bot number is already assigned to another salon."), error.requestId);
    }
    const detail = error.message.startsWith("HTTP_") ? fallbackMessage : error.message;
    return error.requestId ? `${detail} (requestId: ${error.requestId})` : detail;
  }
  return fallbackMessage;
}

function withRequestId(message: string, requestId: string | null) {
  return requestId ? `${message} (requestId: ${requestId})` : message;
}

function extractReason(details: unknown) {
  if (!details || typeof details !== "object") {
    return null;
  }
  const source = details as Record<string, unknown>;
  return typeof source.reason === "string" ? source.reason : null;
}

function resolveEmailVerificationRequiredMessage() {
  return resolveLocalizedMessage("Please verify your email to create or edit data.");
}

function resolveLocalizedMessage(english: string) {
  if (typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("it")) {
    if (english === "Please verify your email to create or edit data.") {
      return "Verifica la tua email per creare o modificare i dati.";
    }
    if (english === "Enter a valid WhatsApp bot number in international format.") {
      return "Inserisci un numero WhatsApp bot valido in formato internazionale.";
    }
    if (english === "Enter a valid operator WhatsApp number in international format.") {
      return "Inserisci un numero WhatsApp operatore valido in formato internazionale.";
    }
    if (english === "Bot number and operator number must be different.") {
      return "Il numero del bot e quello dell'operatore devono essere diversi.";
    }
    if (english === "This bot number is already assigned to another salon.") {
      return "Questo numero bot è già assegnato a un altro salone.";
    }
  }
  return english;
}
