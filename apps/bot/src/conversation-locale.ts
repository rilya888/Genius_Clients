import type { SupportedLocale } from "@genius/i18n";

export type ConversationLocaleReason =
  | "text_marker_it"
  | "text_marker_en"
  | "session_locale"
  | "tenant_default"
  | "raw_inbound";

export function resolveConversationLocale(input: {
  text?: string;
  rawInboundLocale?: SupportedLocale;
  sessionLocale?: SupportedLocale;
  tenantDefaultLocale: SupportedLocale;
}): {
  resolvedLocale: SupportedLocale;
  localeReason: ConversationLocaleReason;
} {
  const normalized = input.text?.trim().toLowerCase() ?? "";

  if (
    /\b(ciao|salve|buongiorno|buonasera|vorrei|prenotazione|prenotare|annulla|sposta|domani|oggi|sera|servizio|servizi|orario|orari|operatore|umano|grazie|per favore|disponibilita|venerdi|sabato|domenica|lunedi|martedi|mercoledi|giovedi)\b/.test(
      normalized
    )
  ) {
    return { resolvedLocale: "it", localeReason: "text_marker_it" };
  }

  if (
    /\b(hello|hi|hey|booking|book|cancel|reschedule|service|services|tomorrow|today|evening|time|times|operator|human|please|thanks|thank you|availability|available|need|want|schedule|friday|saturday|sunday|monday|tuesday|wednesday|thursday)\b/.test(
      normalized
    )
  ) {
    return { resolvedLocale: "en", localeReason: "text_marker_en" };
  }

  if (input.sessionLocale) {
    return { resolvedLocale: input.sessionLocale, localeReason: "session_locale" };
  }

  if (input.rawInboundLocale) {
    return { resolvedLocale: input.rawInboundLocale, localeReason: "raw_inbound" };
  }

  return { resolvedLocale: input.tenantDefaultLocale, localeReason: "tenant_default" };
}
