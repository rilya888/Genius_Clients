import type { SupportedLocale } from "@genius/i18n";
import type { WhatsAppConversationSession } from "./whatsapp-conversation";

export const OPENAI_PROMPT_VERSION = "2026-03-13.1";

export function buildBookingAssistantInstructions(input: {
  locale: SupportedLocale;
  tenantName: string;
  tenantTimezone: string;
  session: WhatsAppConversationSession | null;
}) {
  const languageRule =
    input.locale === "it"
      ? "Always reply in Italian."
      : "Always reply in English.";

  const sessionSummary = input.session?.lastAiSummary?.trim()
    ? `Existing conversation summary: ${input.session.lastAiSummary.trim()}`
    : "Existing conversation summary: none.";

  return [
    `Prompt version: ${OPENAI_PROMPT_VERSION}.`,
    "You are a formal WhatsApp booking assistant for a service business.",
    languageRule,
    `Tenant name: ${input.tenantName}.`,
    `Tenant timezone: ${input.tenantTimezone}.`,
    sessionSummary,
    "Keep replies short and practical.",
    "Never invent services, masters, dates, slots, availability, booking codes, or booking status.",
    "Never confirm, cancel, or reschedule a booking unless a backend tool succeeds.",
    "If data is ambiguous, use a tool first. If multiple options remain, ask for a choice or let the caller render a list.",
    "If the user asks for a human or repeated failures happen, use the handoff tool.",
    "Do not expose internal IDs, system fields, or secrets in user-facing text.",
    "If a tool already returned structured options, do not repeat them in a long text response."
  ].join("\n");
}

export function buildConversationInput(input: {
  locale: SupportedLocale;
  userText: string;
  session: WhatsAppConversationSession | null;
}) {
  return [
    `Locale hint: ${input.locale}.`,
    `Current mode: ${input.session?.currentMode ?? "deterministic"}.`,
    `Current state: ${input.session?.state ?? "choose_intent"}.`,
    `Current intent: ${input.session?.intent ?? "unknown"}.`,
    `Selected service: ${input.session?.serviceName ?? "none"}.`,
    `Selected master: ${input.session?.masterName ?? "none"}.`,
    `Selected date: ${input.session?.date ?? "none"}.`,
    `Selected slot: ${input.session?.slotDisplayTime ?? "none"}.`,
    `Booking in context: ${input.session?.bookingIdInContext ?? input.session?.bookingIdToReschedule ?? "none"}.`,
    `User message: ${input.userText}`
  ].join("\n");
}
