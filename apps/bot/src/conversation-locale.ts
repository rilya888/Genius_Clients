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
  markerScores: { it: number; en: number };
  inferenceScores: { it: number; en: number };
  usedSessionHold: boolean;
} {
  const normalized = input.text?.trim().toLowerCase() ?? "";
  if (!normalized) {
    if (input.sessionLocale) {
      return {
        resolvedLocale: input.sessionLocale,
        localeReason: "session_locale",
        markerScores: { it: 0, en: 0 },
        inferenceScores: { it: 0, en: 0 },
        usedSessionHold: false
      };
    }
    if (input.rawInboundLocale) {
      return {
        resolvedLocale: input.rawInboundLocale,
        localeReason: "raw_inbound",
        markerScores: { it: 0, en: 0 },
        inferenceScores: { it: 0, en: 0 },
        usedSessionHold: false
      };
    }
    return {
      resolvedLocale: input.tenantDefaultLocale,
      localeReason: "tenant_default",
      markerScores: { it: 0, en: 0 },
      inferenceScores: { it: 0, en: 0 },
      usedSessionHold: false
    };
  }

  const words = tokenize(normalized);
  if (input.sessionLocale && isNeutralShortFollowup(words, normalized)) {
    return {
      resolvedLocale: input.sessionLocale,
      localeReason: "session_locale",
      markerScores: { it: 0, en: 0 },
      inferenceScores: { it: 0, en: 0 },
      usedSessionHold: true
    };
  }

  const italianMarkerScore = countMatches(normalized, words, ITALIAN_MARKERS, ITALIAN_PHRASES);
  const englishMarkerScore = countMatches(normalized, words, ENGLISH_MARKERS, ENGLISH_PHRASES);
  const markerScores = { it: italianMarkerScore, en: englishMarkerScore };

  if (italianMarkerScore > englishMarkerScore && italianMarkerScore > 0) {
    return {
      resolvedLocale: "it",
      localeReason: "text_marker_it",
      markerScores,
      inferenceScores: { it: 0, en: 0 },
      usedSessionHold: false
    };
  }

  if (englishMarkerScore > italianMarkerScore && englishMarkerScore > 0) {
    return {
      resolvedLocale: "en",
      localeReason: "text_marker_en",
      markerScores,
      inferenceScores: { it: 0, en: 0 },
      usedSessionHold: false
    };
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
  const inferenceScores = { it: italianScore, en: englishScore };

  if (italianScore > englishScore && italianScore > 0) {
    return {
      resolvedLocale: "it",
      localeReason: "text_inferred_it",
      markerScores,
      inferenceScores,
      usedSessionHold: false
    };
  }
  if (englishScore > italianScore && englishScore > 0) {
    return {
      resolvedLocale: "en",
      localeReason: "text_inferred_en",
      markerScores,
      inferenceScores,
      usedSessionHold: false
    };
  }

  // Keep active conversation language for neutral/ambiguous short replies.
  if (input.sessionLocale) {
    return {
      resolvedLocale: input.sessionLocale,
      localeReason: "session_locale",
      markerScores,
      inferenceScores,
      usedSessionHold: false
    };
  }

  if (input.rawInboundLocale) {
    return {
      resolvedLocale: input.rawInboundLocale,
      localeReason: "raw_inbound",
      markerScores,
      inferenceScores,
      usedSessionHold: false
    };
  }

  return {
    resolvedLocale: input.tenantDefaultLocale,
    localeReason: "tenant_default",
    markerScores,
    inferenceScores,
    usedSessionHold: false
  };
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
  "mostra",
  "mostrami",
  "con",
  "mia",
  "mio",
  "mie",
  "miei",
  "ho",
  "posso",
  "aiutami"
];

const ENGLISH_MARKERS = [
  "hello",
  "hi",
  "hey",
  "booking",
  "book",
  "bookings",
  "cancel",
  "delete",
  "remove",
  "reschedule",
  "move",
  "change",
  "service",
  "services",
  "with",
  "show",
  "my",
  "need",
  "want",
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

const ITALIAN_PHRASES = [
  "per favore",
  "mie prenotazioni",
  "i miei appuntamenti",
  "le mie prenotazioni",
  "voglio prenotare",
  "vorrei prenotare",
  "mostra i servizi",
  "con anna"
];
const ENGLISH_PHRASES = [
  "thank you",
  "my bookings",
  "my booking",
  "can you",
  "i want",
  "i need",
  "show services",
  "book me",
  "with anna"
];

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
