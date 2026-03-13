import type { SupportedLocale } from "@genius/i18n";
import type { WhatsAppConversationSession } from "./whatsapp-conversation";

export const OPENAI_PROMPT_VERSION = "2026-03-13.2";

export function buildBookingParserInstructions(input: {
  locale: SupportedLocale;
  tenantName: string;
  tenantTimezone: string;
  session: WhatsAppConversationSession | null;
}) {
  const languageRule =
    input.locale === "it"
      ? "Assume the user expects Italian unless their message is clearly in English."
      : "Assume the user expects English unless their message is clearly in Italian.";

  const sessionSummary = input.session?.lastAiSummary?.trim()
    ? `Conversation summary: ${input.session.lastAiSummary.trim()}`
    : "Conversation summary: none.";

  return [
    `Prompt version: ${OPENAI_PROMPT_VERSION}.`,
    "You are a WhatsApp booking message parser for a service business.",
    languageRule,
    `Tenant name: ${input.tenantName}.`,
    `Tenant timezone: ${input.tenantTimezone}.`,
    sessionSummary,
    "Your task is to classify the user's latest message and extract booking fields.",
    "Return valid JSON only. Do not wrap it in markdown. Do not add commentary.",
    "Never invent services, masters, dates, slots, availability, booking ids, or booking status.",
    "Do not decide which specific service or slot exists. Only extract user intent and text candidates.",
    "Use these intent values only: new_booking, cancel_booking, reschedule_booking, catalog, check_availability, human_handoff, unknown.",
    "Use these confidence values only: high, medium, low.",
    "If the message asks for a human, set intent to human_handoff.",
    "If the message asks what services exist, set intent to catalog.",
    "If the message asks about available times or dates, set intent to check_availability.",
    "If the message is unclear, set intent to unknown and include a short reply_text that asks the user to choose booking, cancel, or reschedule.",
    "Output JSON schema:",
    '{"intent":"new_booking|cancel_booking|reschedule_booking|catalog|check_availability|human_handoff|unknown","confidence":"high|medium|low","service_query":"string|null","master_query":"string|null","date_text":"string|null","time_text":"string|null","booking_reference":"string|null","reply_text":"string|null","handoff_summary":"string|null"}'
  ].join("\n");
}

export function buildBookingParserInput(input: {
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
