import { ApiHttpError } from "./http";

export function formatApiError(error: unknown, fallbackMessage: string) {
  if (error instanceof ApiHttpError) {
    const reason = extractReason(error.details);
    if (reason === "email_verification_required_for_write_operations") {
      const detail = resolveEmailVerificationRequiredMessage();
      return error.requestId ? `${detail} (requestId: ${error.requestId})` : detail;
    }
    if (reason === "billing_read_only_active") {
      return withRequestId(resolveLocalizedMessage("Billing read-only mode is active."), error.requestId);
    }
    if (reason === "completed_amount_invalid") {
      return withRequestId(resolveLocalizedMessage("Amount must be a positive number."), error.requestId);
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
    if (reason === "whatsapp_desired_bot_required_for_connected_endpoint") {
      return withRequestId(
        resolveLocalizedMessage("Set the bot number before saving because a WhatsApp endpoint is already connected."),
        error.requestId
      );
    }
    if (reason === "whatsapp_operator_required_for_connected_endpoint") {
      return withRequestId(
        resolveLocalizedMessage("Set the operator number before saving because a WhatsApp endpoint is already connected."),
        error.requestId
      );
    }
    if (reason === "whatsapp_routing_mismatch_for_tenant") {
      return withRequestId(
        resolveLocalizedMessage("The selected bot number does not match the connected WhatsApp endpoint for this salon."),
        error.requestId
      );
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
    if (english === "Set the bot number before saving because a WhatsApp endpoint is already connected.") {
      return "Imposta il numero bot prima di salvare perché è già collegato un endpoint WhatsApp.";
    }
    if (english === "Set the operator number before saving because a WhatsApp endpoint is already connected.") {
      return "Imposta il numero operatore prima di salvare perché è già collegato un endpoint WhatsApp.";
    }
    if (english === "The selected bot number does not match the connected WhatsApp endpoint for this salon.") {
      return "Il numero bot selezionato non corrisponde all'endpoint WhatsApp collegato per questo salone.";
    }
    if (english === "Billing read-only mode is active.") {
      return "La modalità sola lettura per fatturazione è attiva.";
    }
    if (english === "Amount must be a positive number.") {
      return "L'importo deve essere un numero positivo.";
    }
  }
  return english;
}
