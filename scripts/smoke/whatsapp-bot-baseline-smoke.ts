import { resolveConversationLocale } from "../../apps/bot/src/conversation-locale";
import { applyConversationResetPolicy } from "../../apps/bot/src/conversation-reset-policy";
import { createInitialSession } from "../../apps/bot/src/whatsapp-conversation";

type SmokeAssertion = {
  name: string;
  passed: boolean;
  details: Record<string, unknown>;
};

async function main() {
  const assertions: SmokeAssertion[] = [];

  const deps = {
    fetchServices: async () => [
      { id: "svc_haircut", displayName: "Haircut" },
      { id: "svc_color", displayName: "Color" }
    ],
    fetchMasters: async () => [
      { id: "master_anna", displayName: "Anna" },
      { id: "master_alex", displayName: "Alex" }
    ]
  };

  const baseSession = createInitialSession("it");
  baseSession.state = "choose_service";
  baseSession.intent = "new_booking";
  baseSession.locale = "it";
  baseSession.lastUserMessageAt = new Date(Date.now() - 2 * 60_000).toISOString();

  const cancelReset = await applyConversationResetPolicy(
    {
      session: baseSession,
      locale: "en",
      text: "cancel my booking",
      now: new Date(),
      idleResetMinutes: 45
    },
    deps
  );

  assertions.push({
    name: "cancel_message_resets_into_cancel_intent",
    passed:
      cancelReset.decision === "hard_reset_to_new_intent" &&
      cancelReset.detectedIntent === "cancel_booking" &&
      cancelReset.shouldRerouteCurrentMessage,
    details: {
      decision: cancelReset.decision,
      detectedIntent: cancelReset.detectedIntent,
      reason: cancelReset.reason,
      reroute: cancelReset.shouldRerouteCurrentMessage
    }
  });

  const freeTextReset = await applyConversationResetPolicy(
    {
      session: baseSession,
      locale: "en",
      text: "hello there",
      now: new Date(),
      idleResetMinutes: 45
    },
    deps
  );

  assertions.push({
    name: "non_continuation_resets_and_reroutes",
    passed:
      freeTextReset.decision === "hard_reset_to_new_intent" &&
      freeTextReset.reason === "non_continuation_message" &&
      freeTextReset.shouldRerouteCurrentMessage,
    details: {
      decision: freeTextReset.decision,
      detectedIntent: freeTextReset.detectedIntent,
      reason: freeTextReset.reason,
      reroute: freeTextReset.shouldRerouteCurrentMessage
    }
  });

  const serviceContinuation = await applyConversationResetPolicy(
    {
      session: baseSession,
      locale: "it",
      text: "Haircut",
      now: new Date(),
      idleResetMinutes: 45
    },
    deps
  );

  assertions.push({
    name: "service_name_continues_choose_service_step",
    passed:
      serviceContinuation.decision === "continue_current_flow" &&
      serviceContinuation.currentStepContinuationMatched &&
      serviceContinuation.continuationClassifier === "semantic",
    details: {
      decision: serviceContinuation.decision,
      matched: serviceContinuation.currentStepContinuationMatched,
      classifier: serviceContinuation.continuationClassifier,
      matchedCandidateCount: serviceContinuation.matchedCandidateCount
    }
  });

  const englishLocale = resolveConversationLocale({
    text: "cancel my booking",
    sessionLocale: "it",
    tenantDefaultLocale: "it"
  });

  assertions.push({
    name: "english_text_overrides_italian_session_locale",
    passed: englishLocale.resolvedLocale === "en" && englishLocale.localeReason === "text_marker_en",
    details: englishLocale
  });

  const italianLocale = resolveConversationLocale({
    text: "annulla prenotazione",
    sessionLocale: "en",
    tenantDefaultLocale: "it"
  });

  assertions.push({
    name: "italian_text_overrides_english_session_locale",
    passed: italianLocale.resolvedLocale === "it" && italianLocale.localeReason === "text_marker_it",
    details: italianLocale
  });

  const neutralLocale = resolveConversationLocale({
    text: "ok",
    sessionLocale: "it",
    tenantDefaultLocale: "it"
  });

  assertions.push({
    name: "neutral_followup_keeps_session_locale",
    passed: neutralLocale.resolvedLocale === "it" && neutralLocale.usedSessionHold,
    details: neutralLocale
  });

  const failed = assertions.filter((item) => !item.passed);
  console.log(JSON.stringify({ assertions, failedCount: failed.length }, null, 2));
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

void main();
