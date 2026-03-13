import type { SupportedLocale } from "@genius/i18n";
import {
  createInitialSession,
  resetSessionForNewConversation,
  type ConversationIntent,
  type ConversationResetReason,
  type ConversationState,
  type WhatsAppConversationSession
} from "./whatsapp-conversation";

export type ResetDetectedIntent = ConversationIntent | "human_handoff" | "unknown";

export type ConversationResetDecision =
  | "continue_current_flow"
  | "hard_reset_to_menu"
  | "hard_reset_to_new_intent"
  | "reset_due_to_timeout";

export type ApplyConversationResetPolicyResult = {
  session: WhatsAppConversationSession;
  decision: ConversationResetDecision;
  reason?: ConversationResetReason;
  detectedIntent: ResetDetectedIntent;
  idleMinutes?: number;
  shouldSkipAi: boolean;
};

export function applyConversationResetPolicy(input: {
  session: WhatsAppConversationSession | null;
  locale: SupportedLocale;
  text?: string;
  replyId?: string;
  now: Date;
  idleResetMinutes: number;
}): ApplyConversationResetPolicyResult {
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
      shouldSkipAi: true
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
      shouldSkipAi: true
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
        shouldSkipAi: false
      };
    }

    return {
      session: touchSession(session, nowIso, input.locale),
      decision: "continue_current_flow",
      detectedIntent,
      idleMinutes,
      shouldSkipAi: false
    };
  }

  if (input.replyId) {
    return {
      session: touchSession(session, nowIso, input.locale),
      decision: "continue_current_flow",
      detectedIntent,
      idleMinutes,
      shouldSkipAi: false
    };
  }

  if (detectedIntent !== "unknown" && session.intent && isIntentConflict(session.intent, detectedIntent)) {
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
      shouldSkipAi: false
    };
  }

  if (detectedIntent !== "unknown" && isStandaloneIntentMessage(normalizedText)) {
    return {
      session: resetSessionForNewConversation({
        locale: input.locale,
        nowIso,
        reason: session.intent ? "intent_conflict" : "non_continuation_message"
      }),
      decision: "hard_reset_to_new_intent",
      reason: session.intent ? "intent_conflict" : "non_continuation_message",
      detectedIntent,
      idleMinutes,
      shouldSkipAi: false
    };
  }

  if (isContinuationOfCurrentStep(session.state, normalizedText, session)) {
    return {
      session: touchSession(session, nowIso, input.locale),
      decision: "continue_current_flow",
      detectedIntent,
      idleMinutes,
      shouldSkipAi: false
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
      shouldSkipAi: true
    };
  }

  return {
    session: touchSession(session, nowIso, input.locale),
    decision: "continue_current_flow",
    detectedIntent,
    idleMinutes,
    shouldSkipAi: false
  };
}

export function detectIntentForReset(text: string): ResetDetectedIntent {
  if (!text) {
    return "unknown";
  }

  if (
    /\b(human|operator|person|admin|assistenza|operatore|umano|amministratore|support)\b/.test(
      text
    )
  ) {
    return "human_handoff";
  }

  if (
    /\b(cancel|annulla|delete booking|remove booking|cancel booking|annullare)\b/.test(text)
  ) {
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

export function isContinuationOfCurrentStep(
  state: ConversationState,
  text: string,
  session: WhatsAppConversationSession
): boolean {
  if (!text) {
    return false;
  }

  if (text.startsWith("service:") || text.startsWith("master:") || text.startsWith("date:") || text.startsWith("slot:") || text.startsWith("confirm:") || text.startsWith("booking:")) {
    return true;
  }

  switch (state) {
    case "choose_intent":
      return false;
    case "choose_service":
      return isShortSelectionLike(text, session.serviceName);
    case "choose_master":
      return isShortSelectionLike(text, session.masterName);
    case "choose_date":
      return /\b(today|tomorrow|oggi|domani)\b/.test(text) || isDateLike(text);
    case "choose_slot":
      return isTimeLike(text);
    case "confirm":
      return /\b(yes|confirm|change|cancel|si|sì|conferma|cambia|annulla|no)\b/.test(text);
    case "cancel_wait_booking_id":
    case "reschedule_wait_booking_id":
      return isUuidLike(text) || text.startsWith("booking:");
    default:
      return false;
  }
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

function isIntentConflict(currentIntent: ConversationIntent, detectedIntent: ResetDetectedIntent) {
  return (
    (detectedIntent === "new_booking" ||
      detectedIntent === "cancel_booking" ||
      detectedIntent === "reschedule_booking") &&
    currentIntent !== detectedIntent
  );
}

function isStandaloneIntentMessage(text: string) {
  return text.length >= 8 || text.split(/\s+/).length >= 2;
}

function isShortSelectionLike(text: string, selectedName?: string) {
  if (text.length <= 40 && text.split(/\s+/).length <= 5) {
    return true;
  }

  const normalizedSelected = selectedName?.trim().toLowerCase();
  if (normalizedSelected && text.includes(normalizedSelected)) {
    return true;
  }

  return false;
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
