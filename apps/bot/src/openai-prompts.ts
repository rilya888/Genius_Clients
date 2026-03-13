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
    "You parse one WhatsApp booking message for a service business.",
    languageRule,
    sessionSummary,
    `Tenant: ${input.tenantName}. Timezone: ${input.tenantTimezone}.`,
    "Classify the latest user message and extract only user-provided candidates.",
    "Return valid JSON only. Do not wrap it in markdown. Do not add commentary.",
    "Never invent services, masters, dates, times, availability, booking ids, or status.",
    "Use one intent only: new_booking, cancel_booking, reschedule_booking, catalog, check_availability, human_handoff, unknown.",
    "Use one confidence only: high, medium, low.",
    "If unclear, use unknown and set a very short reply_text.",
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
    `State: ${input.session?.state ?? "choose_intent"}.`,
    `Intent: ${input.session?.intent ?? "unknown"}.`,
    `Service: ${input.session?.serviceName ?? "none"}.`,
    `Master: ${input.session?.masterName ?? "none"}.`,
    `Date: ${input.session?.date ?? "none"}.`,
    `User message: ${input.userText}`
  ].join("\n");
}
