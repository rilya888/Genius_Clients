import type { SupportedLocale } from "@genius/i18n";

export type ConversationLocaleReason =
  | "text_marker_it"
  | "text_marker_en"
  | "text_inferred_it"
  | "text_inferred_en"
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
  const words = tokenize(normalized);

  const italianMarkerPattern =
    /\b(ciao|salve|buongiorno|buonasera|vorrei|prenotazione|prenotare|annulla|sposta|domani|oggi|sera|servizio|servizi|orario|orari|operatore|umano|grazie|per favore|disponibilita|venerdi|sabato|domenica|lunedi|martedi|mercoledi|giovedi|appuntamento|appuntamenti|mie|miei|ho|voglio|posso|aiutami)\b/;
  const englishMarkerPattern =
    /\b(hello|hi|hey|booking|book|cancel|reschedule|service|services|tomorrow|today|evening|time|times|operator|human|please|thanks|thank you|availability|available|need|want|schedule|friday|saturday|sunday|monday|tuesday|wednesday|thursday|appointment|appointments|my bookings|my booking|can you|i want|i need|show)\b/;

  if (italianMarkerPattern.test(normalized)) {
    return { resolvedLocale: "it", localeReason: "text_marker_it" };
  }

  if (englishMarkerPattern.test(normalized)) {
    return { resolvedLocale: "en", localeReason: "text_marker_en" };
  }

  const italianScore = scoreLanguage(words, [
    "ciao",
    "salve",
    "prenotazione",
    "prenotazioni",
    "prenotare",
    "annulla",
    "sposta",
    "servizio",
    "servizi",
    "appuntamento",
    "appuntamenti",
    "oggi",
    "domani",
    "grazie",
    "voglio",
    "mie",
    "miei",
    "aiuto"
  ]);
  const englishScore = scoreLanguage(words, [
    "hello",
    "hi",
    "booking",
    "bookings",
    "book",
    "cancel",
    "reschedule",
    "service",
    "services",
    "appointment",
    "appointments",
    "today",
    "tomorrow",
    "thanks",
    "please",
    "want",
    "need",
    "show",
    "my"
  ]);

  if (italianScore > englishScore && italianScore > 0) {
    return { resolvedLocale: "it", localeReason: "text_inferred_it" };
  }
  if (englishScore > italianScore && englishScore > 0) {
    return { resolvedLocale: "en", localeReason: "text_inferred_en" };
  }

  if (words.length >= 3 && isMostlyAsciiLatin(words)) {
    return { resolvedLocale: "en", localeReason: "text_inferred_en" };
  }

  if (input.sessionLocale) {
    return { resolvedLocale: input.sessionLocale, localeReason: "session_locale" };
  }

  return { resolvedLocale: input.tenantDefaultLocale, localeReason: "tenant_default" };
}

function tokenize(text: string) {
  return text
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function scoreLanguage(words: string[], dictionary: string[]) {
  const set = new Set(dictionary);
  let score = 0;
  for (const word of words) {
    if (set.has(word)) {
      score += 1;
    }
  }
  return score;
}

function isMostlyAsciiLatin(words: string[]) {
  if (words.length === 0) {
    return false;
  }
  const asciiLike = words.filter((word) => /^[a-z0-9']+$/i.test(word)).length;
  return asciiLike / words.length >= 0.8;
}
