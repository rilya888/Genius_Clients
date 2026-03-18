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
  if (!normalized) {
    if (input.sessionLocale) {
      return { resolvedLocale: input.sessionLocale, localeReason: "session_locale" };
    }
    if (input.rawInboundLocale) {
      return { resolvedLocale: input.rawInboundLocale, localeReason: "raw_inbound" };
    }
    return { resolvedLocale: input.tenantDefaultLocale, localeReason: "tenant_default" };
  }

  const words = tokenize(normalized);
  if (input.sessionLocale && isNeutralShortFollowup(words, normalized)) {
    return { resolvedLocale: input.sessionLocale, localeReason: "session_locale" };
  }

  const italianMarkerScore = countMatches(normalized, words, ITALIAN_MARKERS, ITALIAN_PHRASES);
  const englishMarkerScore = countMatches(normalized, words, ENGLISH_MARKERS, ENGLISH_PHRASES);

  if (italianMarkerScore > englishMarkerScore && italianMarkerScore > 0) {
    return { resolvedLocale: "it", localeReason: "text_marker_it" };
  }

  if (englishMarkerScore > italianMarkerScore && englishMarkerScore > 0) {
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

  // Keep active conversation language for neutral/ambiguous short replies.
  if (input.sessionLocale) {
    return { resolvedLocale: input.sessionLocale, localeReason: "session_locale" };
  }

  if (input.rawInboundLocale) {
    return { resolvedLocale: input.rawInboundLocale, localeReason: "raw_inbound" };
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

function countMatches(
  normalized: string,
  words: string[],
  wordMarkers: string[],
  phraseMarkers: string[]
) {
  const wordSet = new Set(wordMarkers);
  let score = 0;
  for (const word of words) {
    if (wordSet.has(word)) {
      score += 1;
    }
  }
  for (const phrase of phraseMarkers) {
    if (normalized.includes(phrase)) {
      score += 2;
    }
  }
  return score;
}

const ITALIAN_MARKERS = [
  "ciao",
  "salve",
  "buongiorno",
  "buonasera",
  "vorrei",
  "prenotazione",
  "prenotazioni",
  "prenotare",
  "annulla",
  "annullare",
  "sposta",
  "riprogramma",
  "domani",
  "oggi",
  "stasera",
  "servizio",
  "servizi",
  "orario",
  "orari",
  "operatore",
  "umano",
  "grazie",
  "disponibilita",
  "disponibilità",
  "venerdi",
  "venerdì",
  "sabato",
  "domenica",
  "lunedi",
  "lunedì",
  "martedi",
  "martedì",
  "mercoledi",
  "mercoledì",
  "giovedi",
  "giovedì",
  "appuntamento",
  "appuntamenti",
  "voglio",
  "posso",
  "aiutami"
];

const ENGLISH_MARKERS = [
  "hello",
  "hi",
  "hey",
  "booking",
  "book",
  "cancel",
  "reschedule",
  "service",
  "services",
  "tomorrow",
  "today",
  "evening",
  "time",
  "times",
  "operator",
  "human",
  "please",
  "thanks",
  "availability",
  "available",
  "schedule",
  "friday",
  "saturday",
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "appointment",
  "appointments"
];

const ITALIAN_PHRASES = ["per favore", "mie prenotazioni", "i miei appuntamenti", "le mie prenotazioni"];
const ENGLISH_PHRASES = ["thank you", "my bookings", "my booking", "can you", "i want", "i need"];

function isNeutralShortFollowup(words: string[], normalized: string) {
  if (!normalized) {
    return true;
  }
  if (words.length > 2) {
    return false;
  }
  const neutralSet = new Set([
    "ok",
    "okay",
    "yes",
    "no",
    "si",
    "sì",
    "va",
    "bene",
    "domani",
    "oggi",
    "tomorrow",
    "today",
    "thanks",
    "grazie"
  ]);
  return words.every((word) => neutralSet.has(word));
}
