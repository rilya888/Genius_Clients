import type { SupportedLocale } from "@genius/i18n";
import {
  createInitialSession,
  resetSessionForNewConversation,
  type ConversationIntent,
  type ConversationResetReason,
  type ConversationState,
  type WhatsAppConversationSession
} from "./whatsapp-conversation";

type CandidateItem = {
  id: string;
  displayName: string;
};

export type ResetDetectedIntent = ConversationIntent | "booking_list" | "human_handoff" | "unknown";

export type ConversationResetDecision =
  | "continue_current_flow"
  | "hard_reset_to_menu"
  | "hard_reset_to_new_intent"
  | "reset_due_to_timeout";

export type ContinuationClassifier = "token" | "semantic" | "none";
export type ContinuationCandidateType = "service" | "master" | "date" | "slot" | "confirm" | "booking" | null;

export type ApplyConversationResetPolicyResult = {
  session: WhatsAppConversationSession;
  decision: ConversationResetDecision;
  reason?: ConversationResetReason;
  detectedIntent: ResetDetectedIntent;
  idleMinutes?: number;
  shouldResetSession: boolean;
  shouldRerouteCurrentMessage: boolean;
  shouldFallbackToMenuImmediately: boolean;
  currentStepContinuationMatched: boolean;
  continuationClassifier: ContinuationClassifier;
  matchedCandidateCount: number;
  matchedCandidateType: ContinuationCandidateType;
};

export async function applyConversationResetPolicy(
  input: {
    session: WhatsAppConversationSession | null;
    locale: SupportedLocale;
    text?: string;
    replyId?: string;
    now: Date;
    idleResetMinutes: number;
  },
  deps: {
    fetchServices: (locale: SupportedLocale) => Promise<Array<{ id: string; displayName: string }>>;
    fetchMasters: (locale: SupportedLocale, serviceId?: string) => Promise<Array<{ id: string; displayName: string }>>;
  }
): Promise<ApplyConversationResetPolicyResult> {
  const nowIso = input.now.toISOString();
  const session = input.session ?? createInitialSession(input.locale);
  const normalizedText = normalizeText(input.text);
  const detectedIntent = detectIntentForReset(normalizedText);
  const idleMinutes = getIdleMinutes(session.lastUserMessageAt, input.now);

  if (isExplicitResetCommand(normalizedText)) {
    return {
      session: resetSessionForNewConversation({
        locale: input.locale,
        nowIso,
        reason: session.currentMode === "human_handoff" ? "handoff_restart" : "explicit_reset_command"
      }),
      decision: "hard_reset_to_menu",
      reason: session.currentMode === "human_handoff" ? "handoff_restart" : "explicit_reset_command",
      detectedIntent,
      idleMinutes,
        shouldResetSession: true,
        shouldRerouteCurrentMessage: false,
        shouldFallbackToMenuImmediately: true,
        currentStepContinuationMatched: false,
      continuationClassifier: "none",
      matchedCandidateCount: 0,
      matchedCandidateType: null
    };
  }

  if (idleMinutes !== undefined && idleMinutes > input.idleResetMinutes && !input.replyId) {
    return {
      session: resetSessionForNewConversation({
        locale: input.locale,
        nowIso,
        reason: "idle_timeout"
      }),
      decision: "reset_due_to_timeout",
      reason: "idle_timeout",
      detectedIntent,
      idleMinutes,
        shouldResetSession: true,
        shouldRerouteCurrentMessage: true,
        shouldFallbackToMenuImmediately: false,
        currentStepContinuationMatched: false,
      continuationClassifier: "none",
      matchedCandidateCount: 0,
      matchedCandidateType: null
    };
  }

  if (session.currentMode === "human_handoff" || session.handoffStatus === "active") {
    if (detectedIntent !== "unknown") {
      return {
        session: resetSessionForNewConversation({
          locale: input.locale,
          nowIso,
          reason: "handoff_restart"
        }),
        decision: "hard_reset_to_new_intent",
        reason: "handoff_restart",
        detectedIntent,
        idleMinutes,
        shouldResetSession: true,
        shouldRerouteCurrentMessage: true,
        shouldFallbackToMenuImmediately: false,
        currentStepContinuationMatched: false,
        continuationClassifier: "none",
        matchedCandidateCount: 0,
        matchedCandidateType: null
      };
    }

    if (!input.replyId && normalizedText) {
      return {
        session: resetSessionForNewConversation({
          locale: input.locale,
          nowIso,
          reason: "handoff_restart"
        }),
        decision: "hard_reset_to_menu",
        reason: "handoff_restart",
        detectedIntent,
        idleMinutes,
        shouldResetSession: true,
        shouldRerouteCurrentMessage: true,
        shouldFallbackToMenuImmediately: false,
        currentStepContinuationMatched: false,
        continuationClassifier: "none",
        matchedCandidateCount: 0,
        matchedCandidateType: null
      };
    }

    return buildContinueResult(session, nowIso, input.locale, detectedIntent, idleMinutes, {
      matched: false,
      classifier: "none",
      count: 0,
      type: null
    });
  }

  if (input.replyId) {
    return buildContinueResult(session, nowIso, input.locale, detectedIntent, idleMinutes, {
      matched: true,
      classifier: "token",
      count: 1,
      type: classifyTokenType(input.replyId)
    });
  }

  if (detectedIntent !== "unknown" && isIntentConflict(session, detectedIntent)) {
    return {
      session: resetSessionForNewConversation({
        locale: input.locale,
        nowIso,
        reason: "intent_conflict"
      }),
      decision: "hard_reset_to_new_intent",
      reason: "intent_conflict",
      detectedIntent,
      idleMinutes,
        shouldResetSession: true,
        shouldRerouteCurrentMessage: true,
        shouldFallbackToMenuImmediately: false,
        currentStepContinuationMatched: false,
      continuationClassifier: "none",
      matchedCandidateCount: 0,
      matchedCandidateType: null
    };
  }

  if (detectedIntent !== "unknown" && isStandaloneIntentMessage(normalizedText)) {
    if (!session.intent) {
      return {
        session: touchSession(session, nowIso, input.locale),
        decision: "continue_current_flow",
        detectedIntent,
        idleMinutes,
        shouldResetSession: false,
        shouldRerouteCurrentMessage: true,
        shouldFallbackToMenuImmediately: false,
        currentStepContinuationMatched: false,
        continuationClassifier: "none",
        matchedCandidateCount: 0,
        matchedCandidateType: null
      };
    }
    if (!isIntentConflict(session, detectedIntent)) {
      return {
        session: touchSession(session, nowIso, input.locale),
        decision: "continue_current_flow",
        detectedIntent,
        idleMinutes,
        shouldResetSession: false,
        shouldRerouteCurrentMessage: true,
        shouldFallbackToMenuImmediately: false,
        currentStepContinuationMatched: false,
        continuationClassifier: "none",
        matchedCandidateCount: 0,
        matchedCandidateType: null
      };
    }
    return {
      session: resetSessionForNewConversation({
        locale: input.locale,
        nowIso,
        reason: "intent_conflict"
      }),
      decision: "hard_reset_to_new_intent",
      reason: "intent_conflict",
      detectedIntent,
      idleMinutes,
      shouldResetSession: true,
      shouldRerouteCurrentMessage: true,
      shouldFallbackToMenuImmediately: false,
      currentStepContinuationMatched: false,
      continuationClassifier: "none",
      matchedCandidateCount: 0,
      matchedCandidateType: null
    };
  }

  const continuation = await classifyContinuation(session, normalizedText, input.locale, deps);
  if (continuation.matched) {
    return buildContinueResult(session, nowIso, input.locale, detectedIntent, idleMinutes, continuation);
  }

  if (normalizedText && session.state === "choose_intent" && !session.intent) {
    return {
      session: touchSession(session, nowIso, input.locale),
      decision: "continue_current_flow",
      detectedIntent,
      idleMinutes,
      shouldResetSession: false,
      shouldRerouteCurrentMessage: true,
      shouldFallbackToMenuImmediately: false,
      currentStepContinuationMatched: false,
      continuationClassifier: "none",
      matchedCandidateCount: 0,
      matchedCandidateType: null
    };
  }

  if (normalizedText) {
    return {
      session: resetSessionForNewConversation({
        locale: input.locale,
        nowIso,
        reason: "non_continuation_message"
      }),
      decision: "hard_reset_to_menu",
      reason: "non_continuation_message",
      detectedIntent,
      idleMinutes,
      shouldResetSession: true,
      shouldRerouteCurrentMessage: true,
      shouldFallbackToMenuImmediately: false,
      currentStepContinuationMatched: false,
      continuationClassifier: "none",
      matchedCandidateCount: 0,
      matchedCandidateType: null
    };
  }

  return buildContinueResult(session, nowIso, input.locale, detectedIntent, idleMinutes, {
    matched: false,
    classifier: "none",
    count: 0,
    type: null
  });
}

export function detectIntentForReset(text: string): ResetDetectedIntent {
  if (!text) {
    return "unknown";
  }

  if (
    /\b(my bookings|my booking|my appointments|my appointment|show my bookings|show my appointments|what bookings do i have|what appointments do i have|do i have bookings|do i have appointments|le mie prenotazioni|mie prenotazioni|quali prenotazioni ho|quali appuntamenti ho|le mie visite|i miei appuntamenti|mostra le mie prenotazioni|mostra i miei appuntamenti|мои записи|какие у меня записи|мои брони)\b/.test(
      text
    )
  ) {
    return "booking_list";
  }

  if (
    /\b(human|operator|person|admin|assistenza|operatore|umano|amministratore|support)\b/.test(
      text
    )
  ) {
    return "human_handoff";
  }

  if (/\b(cancel|annulla|delete booking|remove booking|cancel booking|annullare)\b/.test(text)) {
    return "cancel_booking";
  }

  if (
    /\b(reschedule|move booking|change booking|sposta|spostare|cambia prenotazione)\b/.test(text)
  ) {
    return "reschedule_booking";
  }

  if (
    /\b(book|booking|book appointment|new booking|prenota|prenotazione|nuova prenotazione|voglio prenotare)\b/.test(
      text
    )
  ) {
    return "new_booking";
  }

  return "unknown";
}

export function toDeterministicIntentToken(intent: ResetDetectedIntent): string | undefined {
  switch (intent) {
    case "new_booking":
      return "intent:new";
    case "cancel_booking":
      return "intent:cancel";
    case "reschedule_booking":
      return "intent:reschedule";
    default:
      return undefined;
  }
}

function buildContinueResult(
  session: WhatsAppConversationSession,
  nowIso: string,
  locale: SupportedLocale,
  detectedIntent: ResetDetectedIntent,
  idleMinutes: number | undefined,
  continuation: {
    matched: boolean;
    classifier: ContinuationClassifier;
    count: number;
    type: ContinuationCandidateType;
  }
): ApplyConversationResetPolicyResult {
  return {
    session: touchSession(session, nowIso, locale),
    decision: "continue_current_flow",
    detectedIntent,
    idleMinutes,
    shouldResetSession: false,
    shouldRerouteCurrentMessage: false,
    shouldFallbackToMenuImmediately: false,
    currentStepContinuationMatched: continuation.matched,
    continuationClassifier: continuation.classifier,
    matchedCandidateCount: continuation.count,
    matchedCandidateType: continuation.type
  };
}

async function classifyContinuation(
  session: WhatsAppConversationSession,
  text: string,
  locale: SupportedLocale,
  deps: {
    fetchServices: (locale: SupportedLocale) => Promise<Array<{ id: string; displayName: string }>>;
    fetchMasters: (locale: SupportedLocale, serviceId?: string) => Promise<Array<{ id: string; displayName: string }>>;
  }
) {
  if (!text) {
    return { matched: false, classifier: "none" as const, count: 0, type: null };
  }

  const tokenType = classifyTokenType(text);
  if (tokenType) {
    return { matched: true, classifier: "token" as const, count: 1, type: tokenType };
  }

  switch (session.state) {
    case "choose_service": {
      const services = await deps.fetchServices(locale);
      const count = countCandidateMatches(text, services);
      return { matched: count > 0, classifier: count > 0 ? ("semantic" as const) : ("none" as const), count, type: count > 0 ? ("service" as const) : null };
    }
    case "choose_master": {
      const masters = await deps.fetchMasters(locale, session.serviceId);
      const count = countCandidateMatches(text, masters);
      return { matched: count > 0, classifier: count > 0 ? ("semantic" as const) : ("none" as const), count, type: count > 0 ? ("master" as const) : null };
    }
    case "choose_date": {
      const matched = /\b(today|tomorrow|oggi|domani)\b/.test(text) || isDateLike(text);
      return { matched, classifier: matched ? ("semantic" as const) : ("none" as const), count: matched ? 1 : 0, type: matched ? ("date" as const) : null };
    }
    case "choose_slot": {
      const matched = isTimeLike(text);
      return { matched, classifier: matched ? ("semantic" as const) : ("none" as const), count: matched ? 1 : 0, type: matched ? ("slot" as const) : null };
    }
    case "confirm": {
      const matched = /\b(yes|confirm|change|cancel|si|sì|conferma|cambia|annulla|no)\b/.test(text);
      return { matched, classifier: matched ? ("semantic" as const) : ("none" as const), count: matched ? 1 : 0, type: matched ? ("confirm" as const) : null };
    }
    case "cancel_wait_booking_id":
    case "reschedule_wait_booking_id": {
      const matched = isUuidLike(text);
      return { matched, classifier: matched ? ("semantic" as const) : ("none" as const), count: matched ? 1 : 0, type: matched ? ("booking" as const) : null };
    }
    default:
      return { matched: false, classifier: "none" as const, count: 0, type: null };
  }
}

function classifyTokenType(text: string): ContinuationCandidateType {
  if (text.startsWith("service:")) return "service";
  if (text.startsWith("master:")) return "master";
  if (text.startsWith("date:")) return "date";
  if (text.startsWith("slot:")) return "slot";
  if (text.startsWith("confirm:")) return "confirm";
  if (text.startsWith("booking:")) return "booking";
  return null;
}

function countCandidateMatches(text: string, items: CandidateItem[]) {
  const normalizedText = normalizeForMatch(text);
  if (!normalizedText) {
    return 0;
  }

  return items.filter((item) => {
    const candidate = normalizeForMatch(item.displayName);
    return candidate === normalizedText || candidate.includes(normalizedText) || normalizedText.includes(candidate);
  }).length;
}

function normalizeForMatch(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

function touchSession(
  session: WhatsAppConversationSession,
  nowIso: string,
  locale: SupportedLocale
): WhatsAppConversationSession {
  return {
    ...session,
    locale,
    lastUserMessageAt: nowIso
  };
}

function normalizeText(text?: string) {
  return text?.trim().toLowerCase() ?? "";
}

function isExplicitResetCommand(text: string) {
  return text === "/start" || text === "start" || text === "menu" || text === "restart";
}

function getIdleMinutes(lastUserMessageAt: string | undefined, now: Date) {
  if (!lastUserMessageAt) {
    return undefined;
  }

  const last = new Date(lastUserMessageAt);
  if (Number.isNaN(last.getTime())) {
    return undefined;
  }

  return Math.floor((now.getTime() - last.getTime()) / 60000);
}

function isIntentConflict(
  session: Pick<WhatsAppConversationSession, "intent" | "state">,
  detectedIntent: ResetDetectedIntent
) {
  const currentIntent = session.intent;
  const activeBookingState =
    session.state === "choose_service" ||
    session.state === "choose_master" ||
    session.state === "choose_date" ||
    session.state === "choose_slot" ||
    session.state === "confirm";

  if (detectedIntent === "cancel_booking" || detectedIntent === "reschedule_booking") {
    if (!currentIntent) {
      return activeBookingState;
    }
    return currentIntent !== detectedIntent;
  }

  if (detectedIntent === "booking_list") {
    if (currentIntent === "new_booking" || currentIntent === "cancel_booking" || currentIntent === "reschedule_booking") {
      return true;
    }
    return activeBookingState;
  }

  if (detectedIntent === "new_booking") {
    if (!currentIntent) {
      return false;
    }
    return currentIntent !== "new_booking";
  }

  return false;
}

function isStandaloneIntentMessage(text: string) {
  return text.length >= 8 || text.split(/\s+/).length >= 2;
}

function isDateLike(text: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(text) || /^\d{1,2}[/. -]\d{1,2}(?:[/. -]\d{2,4})?$/.test(text);
}

function isTimeLike(text: string) {
  return /^\d{1,2}:\d{2}$/.test(text) || /\b\d{1,2}\s?(am|pm)\b/.test(text);
}

function isUuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value.trim()
  );
}
