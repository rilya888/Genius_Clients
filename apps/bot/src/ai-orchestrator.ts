import { randomUUID } from "node:crypto";
import type { SupportedLocale } from "@genius/i18n";
import {
  createInitialSession,
  type ConversationHandoffReason,
  type ConversationIntent,
  type ParsedConversationIntent,
  type WhatsAppConversationSession
} from "./whatsapp-conversation";
import {
  OPENAI_PARSER_SCHEMA_VERSION,
  OPENAI_PROMPT_VERSION,
  buildBookingParserInput,
  buildBookingParserInstructions,
  resolvePromptVersion
} from "./openai-prompts";
import { OpenAIResponsesClient, OpenAIResponsesError } from "./openai-responses-client";
import { resolveConversationLocale } from "./conversation-locale";

type ServiceItem = {
  id: string;
  displayName: string;
  durationMinutes?: number;
};

type MasterItem = {
  id: string;
  displayName: string;
};

type SlotItem = {
  startAt: string;
  displayTime: string;
};

type BookingItem = {
  id: string;
  startAt: string;
  status: string;
  clientName?: string;
};

type Choice = {
  id: string;
  title: string;
  description?: string;
};

type TenantBotConfig = {
  name: string;
  defaultLocale: SupportedLocale;
  timezone: string;
  openaiEnabled: boolean;
  openaiModel: string;
  promptVariant?: string | null;
  humanHandoffEnabled: boolean;
  adminNotificationWhatsappE164?: string | null;
  faqContent?: {
    it?: {
      priceInfo?: string;
      addressInfo?: string;
      parkingInfo?: string;
      workingHoursInfo?: string;
    };
    en?: {
      priceInfo?: string;
      addressInfo?: string;
      parkingInfo?: string;
      workingHoursInfo?: string;
    };
  };
};

type ParsedIntent =
  | ConversationIntent
  | "booking_list"
  | "catalog"
  | "check_availability"
  | "price_info"
  | "address_info"
  | "parking_info"
  | "working_hours_info"
  | "human_handoff"
  | "unknown";

type AiParseResult = {
  schemaVersion?: string;
  intent: ParsedIntent;
  confidence: "high" | "medium" | "low";
  serviceQuery?: string;
  masterQuery?: string;
  dateText?: string;
  timeText?: string;
  bookingReference?: string;
  replyText?: string;
  handoffSummary?: string;
};

type ToolArtifact =
  | { kind: "service_list"; prompt: string; items: ServiceItem[]; intent?: ConversationIntent }
  | {
      kind: "master_list";
      prompt: string;
      serviceId?: string;
      serviceName?: string;
      items: MasterItem[];
      intent?: ConversationIntent;
    }
  | {
      kind: "date_list";
      prompt: string;
      serviceId?: string;
      serviceName?: string;
      masterId?: string;
      masterName?: string;
      items: Array<{ date: string; title: string; description?: string }>;
      intent?: ConversationIntent;
    }
  | {
      kind: "slot_list";
      prompt: string;
      serviceId?: string;
      serviceName?: string;
      masterId?: string;
      masterName?: string;
      date: string;
      items: SlotItem[];
      intent?: ConversationIntent;
    }
  | {
      kind: "booking_list";
      prompt: string;
      action: "cancel" | "reschedule";
      items: BookingItem[];
    }
  | {
      kind: "confirm_booking";
      serviceName?: string;
      masterName?: string;
      date?: string;
      slotDisplayTime?: string;
    }
  | {
      kind: "quick_actions";
      prompt: string;
      items: Choice[];
    }
  | {
      kind: "handoff";
      prompt: string;
      summary: string;
      notified: boolean;
      reason: ConversationHandoffReason;
    }
  | { kind: "none" };

export type AiOrchestratorDeps = {
  loadSession: (phone: string) => Promise<WhatsAppConversationSession | null>;
  saveSession: (phone: string, session: WhatsAppConversationSession) => Promise<void>;
  clearSession: (phone: string) => Promise<void>;
  sendText: (to: string, text: string) => Promise<void>;
  sendList: (to: string, bodyText: string, buttonText: string, choices: Choice[]) => Promise<void>;
  sendButtons: (to: string, bodyText: string, choices: Choice[]) => Promise<void>;
  fetchServices: (locale: SupportedLocale) => Promise<ServiceItem[]>;
  fetchMasters: (locale: SupportedLocale, serviceId?: string) => Promise<MasterItem[]>;
  fetchSlots: (input: {
    serviceId: string;
    masterId?: string;
    date: string;
    locale: SupportedLocale;
  }) => Promise<SlotItem[]>;
  listBookingsByPhone: (input: { phone: string; limit?: number }) => Promise<BookingItem[]>;
  createBooking: (input: {
    serviceId: string;
    masterId?: string;
    startAtIso: string;
    phone: string;
    locale: SupportedLocale;
    clientName?: string;
  }) => Promise<string>;
  cancelBooking: (input: { bookingId: string; phone: string }) => Promise<string>;
  rescheduleBooking: (input: {
    bookingId: string;
    phone: string;
    serviceId: string;
    masterId?: string;
    startAtIso: string;
    locale: SupportedLocale;
  }) => Promise<string>;
  getTenantConfig: () => Promise<TenantBotConfig>;
  notifyAdminHandoff: (input: { phone: string; summary: string; locale: SupportedLocale }) => Promise<boolean>;
  emitOpsAlert?: (input: {
    event: string;
    severity: "warning" | "critical";
    context: Record<string, unknown>;
  }) => Promise<void>;
  consumeAiDailyQuota?: (input: { tenantKey: string; dayKey: string; limit: number }) => Promise<{ allowed: boolean; used: number }>;
};
const BOOKING_SELECTION_BUTTONS_MAX_ITEMS = 2;
const POLICY_VERSION = "2026-03-14.a";
const FAST_PATH_VERSION = "2026-03-14.a";
const AI_MAX_USER_TEXT_CHARS = Math.max(
  120,
  Number.parseInt(process.env.BOT_AI_MAX_INPUT_CHARS ?? "640", 10) || 640
);
const AI_PARSER_TIMEOUT_MS = Math.min(
  20000,
  Math.max(2500, Number.parseInt(process.env.BOT_AI_PARSER_TIMEOUT_MS ?? "8500", 10) || 8500)
);

const RESTART_FLOW_TOKEN = "flow:restart";
const BACK_FLOW_TOKEN = "flow:back";
const CATALOG_HINTS_CACHE_TTL_MS = 5 * 60 * 1000;

const catalogHintsCache = new Map<
  string,
  {
    services: string[];
    masters: string[];
    ts: number;
  }
>();

export async function processAiWhatsAppMessage(
  input: {
    from: string;
    text: string;
    locale: SupportedLocale;
    openAiApiKey: string;
    globalModel: string;
    globalEnabled: boolean;
    tenantQuotaKey: string;
    aiMaxCallsPerSession: number;
    aiMaxCallsPerDay: number;
    aiFailureHandoffThreshold: number;
    unknownTurnHandoffThreshold: number;
  },
  deps: AiOrchestratorDeps
): Promise<{ handled: boolean }> {
  const normalizedInboundText = normalizeInboundUserText(input.text);
  if (!normalizedInboundText || !input.openAiApiKey || !input.globalEnabled) {
    return { handled: false };
  }
  const userText = normalizedInboundText.slice(0, AI_MAX_USER_TEXT_CHARS);
  const inputTruncated = userText.length < normalizedInboundText.length;
  const complaintSignal = hasComplaintSignal(normalizeSearch(userText));

  const tenantConfig = await deps.getTenantConfig();
  if (!tenantConfig.openaiEnabled) {
    return { handled: false };
  }

  const existingSession = await deps.loadSession(input.from);
  const localeResolution = resolveConversationLocale({
    text: userText,
    rawInboundLocale: input.locale,
    sessionLocale: existingSession?.locale,
    tenantDefaultLocale: tenantConfig.defaultLocale
  });
  const detectedLocale = localeResolution.resolvedLocale;
  const traceId = randomUUID();
  const session = existingSession ?? createInitialSession(detectedLocale);
  const nowIso = new Date().toISOString();
  session.locale = detectedLocale;
  session.lastUserMessageAt = nowIso;
  session.currentMode = session.currentMode === "human_handoff" ? "human_handoff" : "ai_assisted";
  session.conversationTraceId = traceId;
  if (complaintSignal && !session.complaintDetectedAt) {
    session.complaintDetectedAt = nowIso;
  }

  if (session.handoffStatus === "active" || session.currentMode === "human_handoff") {
    await deps.saveSession(input.from, session);
    await deps.sendText(
      input.from,
      detectedLocale === "it"
        ? "La richiesta e stata inoltrata all'amministratore. Attendi una risposta."
        : "Your request has been forwarded to the administrator. Please wait for a reply."
    );
    return { handled: true };
  }

  console.info("[bot][ai] inbound normalize", {
    traceId,
    from: maskPhone(input.from),
    locale: detectedLocale,
    localeReason: localeResolution.localeReason,
    inputLength: userText.length,
    inputTruncated,
    state: session.state,
    intent: session.intent ?? "unknown",
    promptVersion: resolvePromptVersion(tenantConfig.promptVariant),
    policyVersion: POLICY_VERSION,
    fastPathVersion: FAST_PATH_VERSION
  });

  const client = new OpenAIResponsesClient(input.openAiApiKey, AI_PARSER_TIMEOUT_MS);

  try {
    const fastPath = detectFastPathIntent(userText, detectedLocale);
    const aiStartedAt = Date.now();
    let parsed: AiParseResult;
    let usedFastPath = false;
    let usedAiParser = false;
    let usedTransportFallback = false;
    let usedCatalogAssistedFastPath = false;
    if (fastPath) {
      parsed = fastPath;
      usedFastPath = true;
      if (
        (parsed.intent === "new_booking" || parsed.intent === "check_availability") &&
        (!parsed.serviceQuery || !parsed.masterQuery)
      ) {
        const catalogHints = await getCatalogHints({
          tenantKey: input.tenantQuotaKey,
          locale: detectedLocale,
          deps
        });
        const catalogAssisted = detectCatalogAssistedFastPath(userText, detectedLocale, catalogHints);
        if (catalogAssisted) {
          parsed = mergeLocalFastPaths(parsed, catalogAssisted) ?? parsed;
          usedCatalogAssistedFastPath = true;
        }
      }
    } else {
      const catalogHints = await getCatalogHints({
        tenantKey: input.tenantQuotaKey,
        locale: detectedLocale,
        deps
      });
      const transportFallback = detectTransportFallbackIntent(userText, detectedLocale);
      const catalogAssisted = detectCatalogAssistedFastPath(userText, detectedLocale, catalogHints);
      const localFastPath = mergeLocalFastPaths(transportFallback, catalogAssisted);
      if (localFastPath) {
        parsed = localFastPath;
        usedTransportFallback = Boolean(transportFallback);
        usedCatalogAssistedFastPath = Boolean(catalogAssisted);
      } else {
      const sessionCallCount = session.aiCallsInSession ?? 0;
      if (sessionCallCount >= input.aiMaxCallsPerSession) {
        console.warn("[bot][ai] session cap reached", {
          traceId,
          tenantKey: input.tenantQuotaKey,
          sessionCallCount,
          aiMaxCallsPerSession: input.aiMaxCallsPerSession
        });
        await deps.emitOpsAlert?.({
          event: "ai_session_cap_reached",
          severity: "warning",
          context: {
            traceId,
            tenantKey: input.tenantQuotaKey,
            sessionCallCount,
            aiMaxCallsPerSession: input.aiMaxCallsPerSession
          }
        });
        const capFallback = detectTransportFallbackIntent(userText, detectedLocale);
        if (capFallback) {
          parsed = capFallback;
          usedTransportFallback = true;
        } else {
          await deps.saveSession(input.from, session);
          await deps.sendText(
            input.from,
            detectedLocale === "it"
              ? "Per continuare velocemente, scegli: prenotare, annullare o spostare."
              : "To continue quickly, choose: book, cancel, or reschedule."
          );
          return { handled: true };
        }
      } else {
        if (deps.consumeAiDailyQuota) {
          const dayKey = buildDayKey(tenantConfig.timezone);
          const quota = await deps.consumeAiDailyQuota({
            tenantKey: input.tenantQuotaKey,
            dayKey,
            limit: input.aiMaxCallsPerDay
          });
          if (!quota.allowed) {
            console.warn("[bot][ai] daily cap reached", {
              traceId,
              tenantKey: input.tenantQuotaKey,
              dayKey,
              used: quota.used,
              aiMaxCallsPerDay: input.aiMaxCallsPerDay
            });
            await deps.emitOpsAlert?.({
              event: "ai_daily_cap_reached",
              severity: "warning",
              context: {
                traceId,
                tenantKey: input.tenantQuotaKey,
                dayKey,
                used: quota.used,
                aiMaxCallsPerDay: input.aiMaxCallsPerDay
              }
            });
            const capFallback = detectTransportFallbackIntent(userText, detectedLocale);
            if (capFallback) {
              parsed = capFallback;
              usedTransportFallback = true;
            } else {
              await deps.saveSession(input.from, session);
              await deps.sendText(
                input.from,
                detectedLocale === "it"
                  ? "Ora rispondo in modalità rapida. Scrivi: prenotare, annullare o spostare."
                  : "I am in quick mode now. Type: book, cancel, or reschedule."
              );
              return { handled: true };
            }
          } else {
            parsed = await parseUserMessage({
              client,
              model: tenantConfig.openaiModel || input.globalModel,
              locale: detectedLocale,
              tenantConfig,
              session,
              catalogHints,
              userText,
              promptVersion: resolvePromptVersion(tenantConfig.promptVariant),
              traceId
            });
            session.aiCallsInSession = sessionCallCount + 1;
            usedAiParser = true;
          }
        } else {
          parsed = await parseUserMessage({
            client,
            model: tenantConfig.openaiModel || input.globalModel,
            locale: detectedLocale,
            tenantConfig,
            session,
            catalogHints,
            userText,
            promptVersion: resolvePromptVersion(tenantConfig.promptVariant),
            traceId
          });
          session.aiCallsInSession = sessionCallCount + 1;
          usedAiParser = true;
        }
      }
      }
    }
    const normalizedParsed = normalizeParsedIntentWithHeuristics(parsed, userText, detectedLocale);
    if (
      !fastPath &&
      normalizedParsed.schemaVersion &&
      normalizedParsed.schemaVersion !== OPENAI_PARSER_SCHEMA_VERSION
    ) {
      console.warn("[bot][ai] parser schema mismatch", {
        traceId,
        receivedSchemaVersion: normalizedParsed.schemaVersion,
        expectedSchemaVersion: OPENAI_PARSER_SCHEMA_VERSION
      });
      await deps.emitOpsAlert?.({
        event: "ai_parser_schema_mismatch",
        severity: "warning",
        context: {
          traceId,
          receivedSchemaVersion: normalizedParsed.schemaVersion,
          expectedSchemaVersion: OPENAI_PARSER_SCHEMA_VERSION
        }
      });
    }

    console.info("[bot][ai] parsed", {
      traceId,
      usedFastPath,
      usedAiParser,
      usedTransportFallback,
      usedCatalogAssistedFastPath,
      intentSource: usedAiParser ? "ai" : "fast",
      aiParserLatencyMs: usedAiParser ? Date.now() - aiStartedAt : 0,
      intent: normalizedParsed.intent,
      confidence: normalizedParsed.confidence,
      hasServiceQuery: Boolean(normalizedParsed.serviceQuery),
      hasMasterQuery: Boolean(normalizedParsed.masterQuery),
      hasDateText: Boolean(normalizedParsed.dateText),
      hasTimeText: Boolean(normalizedParsed.timeText),
      hasBookingReference: Boolean(normalizedParsed.bookingReference),
      parserSchemaVersion: normalizedParsed.schemaVersion ?? "none",
      expectedSchemaVersion: OPENAI_PARSER_SCHEMA_VERSION,
      policyVersion: POLICY_VERSION,
      fastPathVersion: FAST_PATH_VERSION
    });

    const result = await resolveAiPlan(
      {
        locale: detectedLocale,
        tenantConfig,
        session,
        parsed: normalizedParsed,
        rawText: userText,
        phone: input.from,
        traceId,
        unknownTurnHandoffThreshold: input.unknownTurnHandoffThreshold
      },
      deps
    );

    session.lastOpenaiResponseId = undefined;
    session.lastAiSummary = buildSessionSummary(session, normalizedParsed);
    session.aiFailureCount = 0;
    session.lastResolvedIntent = normalizedParsed.intent as ParsedConversationIntent;
    session.unknownTurnCount = normalizedParsed.intent === "unknown" ? (session.unknownTurnCount ?? 0) + 1 : 0;

    if (result.artifact.kind !== "none") {
      logSessionHealth(traceId, session);
      await renderArtifact({ from: input.from, locale: detectedLocale, session, artifact: result.artifact }, deps);
      return { handled: true };
    }

    if (result.outputText) {
      await deps.saveSession(input.from, session);
      await deps.sendText(input.from, sanitizeUserText(result.outputText));
      logSessionHealth(traceId, session);
      console.info("[bot][ai] final render", {
        traceId,
        mode: "text"
      });
      return { handled: true };
    }

    return { handled: false };
  } catch (error) {
    const errorClass = classifyAiError(error);
    session.aiFailureCount = (session.aiFailureCount ?? 0) + 1;
    session.currentMode = "deterministic";
    session.lastOpenaiResponseId = undefined;
    await deps.saveSession(input.from, session);
    console.error("[bot][ai] failure", {
      traceId,
      error: error instanceof Error ? error.message : "unknown_error",
      errorClass,
      failures: session.aiFailureCount
    });
    await deps.emitOpsAlert?.({
      event: "ai_orchestrator_failure",
      severity: "warning",
      context: {
        traceId,
        errorClass,
        failures: session.aiFailureCount ?? 0
      }
    });

    if (errorClass === "openai_transport_error" && isOpenAiQuotaError(error)) {
      const fallbackParsed = detectTransportFallbackIntent(userText, detectedLocale);
      if (fallbackParsed) {
        try {
          const fallbackResult = await resolveAiPlan(
            {
              locale: detectedLocale,
              tenantConfig,
              session,
              parsed: fallbackParsed,
              rawText: userText,
              phone: input.from,
              traceId,
              unknownTurnHandoffThreshold: input.unknownTurnHandoffThreshold
            },
            deps
          );

          session.currentMode = "ai_assisted";
          session.lastAiSummary = buildSessionSummary(session, fallbackParsed);
          session.lastResolvedIntent = fallbackParsed.intent as ParsedConversationIntent;
          session.unknownTurnCount = fallbackParsed.intent === "unknown" ? (session.unknownTurnCount ?? 0) + 1 : 0;
          await deps.saveSession(input.from, session);

          if (fallbackResult.artifact.kind !== "none") {
            logSessionHealth(traceId, session);
            await renderArtifact({ from: input.from, locale: detectedLocale, session, artifact: fallbackResult.artifact }, deps);
            console.info("[bot][ai] transport fallback render", {
              traceId,
              intent: fallbackParsed.intent
            });
            return { handled: true };
          }
          if (fallbackResult.outputText) {
            await deps.sendText(input.from, sanitizeUserText(fallbackResult.outputText));
            logSessionHealth(traceId, session);
            console.info("[bot][ai] transport fallback text", {
              traceId,
              intent: fallbackParsed.intent
            });
            return { handled: true };
          }
        } catch (fallbackError) {
          console.error("[bot][ai] transport fallback failed", {
            traceId,
            error: fallbackError instanceof Error ? fallbackError.message : "unknown_error"
          });
          await deps.emitOpsAlert?.({
            event: "ai_transport_fallback_failed",
            severity: "warning",
            context: {
              traceId,
              error: fallbackError instanceof Error ? fallbackError.message : "unknown_error"
            }
          });
        }
      }

      await deps.sendText(
        input.from,
        detectedLocale === "it"
          ? "Ho un ritardo temporaneo. Puoi scrivere: prenotare, annullare o spostare."
          : "I have a temporary delay. You can type: book, cancel, or reschedule."
      );
      return { handled: true };
    }

    if (tenantConfig.humanHandoffEnabled && (session.aiFailureCount ?? 0) >= input.aiFailureHandoffThreshold) {
      const notified = await deps.notifyAdminHandoff({
        phone: input.from,
        summary: sanitizeHandoffSummary(userText),
        locale: detectedLocale
      });
      await deps.emitOpsAlert?.({
        event: "ai_failure_handoff_triggered",
        severity: "critical",
        context: {
          traceId,
          failures: session.aiFailureCount ?? 0,
          threshold: input.aiFailureHandoffThreshold,
          notified,
          phone: maskPhone(input.from)
        }
      });
      session.currentMode = "human_handoff";
      session.handoffStatus = notified ? "active" : "pending";
      session.handoffReason = "ai_failure";
      session.handoffAt = new Date().toISOString();
      await deps.saveSession(input.from, session);
      logSessionHealth(traceId, session);
      await deps.sendText(
        input.from,
        detectedLocale === "it"
          ? "Non riesco a completare la richiesta. La inoltro all'amministratore."
          : "I cannot complete the request right now. I am forwarding it to the administrator."
      );
      return { handled: true };
    }

    return { handled: false };
  }
}

async function parseUserMessage(input: {
  client: OpenAIResponsesClient;
  model: string;
  locale: SupportedLocale;
  tenantConfig: TenantBotConfig;
  session: WhatsAppConversationSession;
  catalogHints: { services: string[]; masters: string[] };
  userText: string;
  promptVersion: string;
  traceId: string;
}): Promise<AiParseResult> {
  const response = await input.client.create({
    model: input.model,
    instructions: buildBookingParserInstructions({
      locale: input.locale,
      tenantName: input.tenantConfig.name,
      tenantTimezone: input.tenantConfig.timezone,
      session: input.session,
      promptVersion: input.promptVersion
    }),
    input: buildBookingParserInput({
      locale: input.locale,
      userText: input.userText,
      session: input.session,
      availableServices: input.catalogHints.services,
      availableMasters: input.catalogHints.masters
    }),
    turnType: "user_input",
    metadata: {
      trace_id: input.traceId,
      prompt_version: input.promptVersion,
      parser_schema_version: OPENAI_PARSER_SCHEMA_VERSION,
      locale: input.locale
    }
  });

  const payload = extractJsonObject(response.outputText);
  if (!payload) {
    throw new Error("ai_parse_invalid_json");
  }

  return normalizeAiParseResult(payload, input.locale);
}

async function resolveAiPlan(
  input: {
    locale: SupportedLocale;
    tenantConfig: TenantBotConfig;
    session: WhatsAppConversationSession;
    parsed: AiParseResult;
    rawText: string;
    phone: string;
    traceId: string;
    unknownTurnHandoffThreshold: number;
  },
  deps: AiOrchestratorDeps
): Promise<{ artifact: ToolArtifact; outputText?: string }> {
  console.info("[bot][ai] resolver branch", {
    traceId: input.traceId,
    intent: input.parsed.intent
  });

  switch (input.parsed.intent) {
    case "human_handoff": {
      const summary = sanitizeHandoffSummary(
        input.parsed.handoffSummary?.trim() ||
          input.parsed.replyText?.trim() ||
          input.parsed.serviceQuery?.trim() ||
          "Human assistance requested."
      );
      const notified = await deps.notifyAdminHandoff({
        phone: input.phone,
        summary,
        locale: input.locale
      });
      return {
        artifact: {
          kind: "handoff",
          prompt:
            input.locale === "it"
              ? "La richiesta e stata inoltrata all'amministratore."
              : "The request has been forwarded to the administrator.",
          summary,
          notified,
          reason: hasComplaintSignal(normalizeSearch(input.rawText)) ? "complaint" : "user_request"
        }
      };
    }

    case "booking_list": {
      const items = await deps.listBookingsByPhone({ phone: input.phone, limit: 10 });
      if (items.length === 0) {
        logBookingFunnelStep(input.traceId, {
          step: "no_active_bookings",
          locale: input.locale,
          intent: input.parsed.intent
        });
        return {
          artifact: {
            kind: "quick_actions",
            prompt:
              input.locale === "it"
                ? "Non hai prenotazioni attive. Cosa vuoi fare?"
                : "You do not have active bookings. What would you like to do?",
            items: buildIntentQuickActions(input.locale)
          }
        };
      }
      const lines = items.slice(0, 6).map((item, index) => `${index + 1}. ${formatBookingChoice(item.startAt, input.locale)} (${item.status})`);
      return {
        artifact: { kind: "none" },
        outputText:
          input.locale === "it"
            ? `Le tue prenotazioni attive:\n${lines.join("\n")}\n\nPer annullare scrivi: cancel booking.`
            : `Your active bookings:\n${lines.join("\n")}\n\nTo cancel, type: cancel booking.`
      };
    }

    case "cancel_booking": {
      const items = await deps.listBookingsByPhone({ phone: input.phone, limit: 10 });
      logBookingFunnelStep(input.traceId, {
        step: items.length > 0 ? "cancel_selection_shown" : "no_active_bookings",
        locale: input.locale,
        intent: input.parsed.intent
      });
      return {
        artifact: {
          kind: "booking_list",
          prompt:
            input.locale === "it"
              ? "Scegli la prenotazione da annullare."
              : "Choose the booking to cancel.",
          action: "cancel",
          items
        }
      };
    }

    case "reschedule_booking": {
      const items = await deps.listBookingsByPhone({ phone: input.phone, limit: 10 });
      logBookingFunnelStep(input.traceId, {
        step: items.length > 0 ? "reschedule_selection_shown" : "no_active_bookings",
        locale: input.locale,
        intent: input.parsed.intent
      });
      return {
        artifact: {
          kind: "booking_list",
          prompt:
            input.locale === "it"
              ? "Scegli la prenotazione da spostare."
              : "Choose the booking to reschedule.",
          action: "reschedule",
          items
        }
      };
    }

    case "catalog":
    case "check_availability":
    case "new_booking": {
      return resolveBookingLikeIntent(input, deps);
    }

    case "price_info":
    case "address_info":
    case "parking_info":
    case "working_hours_info": {
      const faqText = resolveFaqAnswer(input.tenantConfig, input.locale, input.parsed.intent);
      if (faqText) {
        return {
          artifact: { kind: "none" },
          outputText: faqText
        };
      }
      return {
        artifact: {
          kind: "quick_actions",
          prompt:
            input.locale === "it"
              ? "Ti aiuto subito. Cosa vuoi fare adesso?"
              : "I can help right away. What would you like to do now?",
          items: buildIntentQuickActions(input.locale)
        }
      };
    }

    case "unknown": {
      if (isLikelyNoiseInput(input.rawText)) {
        return {
          artifact: {
            kind: "quick_actions",
            prompt:
              input.locale === "it"
                ? "Messaggio non chiaro. Scegli un'azione."
                : "Message not clear. Please choose an action.",
            items: buildIntentQuickActions(input.locale)
          }
        };
      }
      const nextUnknownTurnCount = (input.session.unknownTurnCount ?? 0) + 1;
      if (
        nextUnknownTurnCount >= input.unknownTurnHandoffThreshold &&
        input.tenantConfig.humanHandoffEnabled
      ) {
        const summary = sanitizeHandoffSummary(
          input.parsed.replyText?.trim() || "Repeated unclear WhatsApp request."
        );
        const notified = await deps.notifyAdminHandoff({
          phone: input.phone,
          summary,
          locale: input.locale
        });
        await deps.emitOpsAlert?.({
          event: "unknown_turn_handoff_triggered",
          severity: "warning",
          context: {
            traceId: input.traceId,
            unknownTurnCount: input.session.unknownTurnCount ?? 0,
            threshold: input.unknownTurnHandoffThreshold,
            notified,
            phone: maskPhone(input.phone)
          }
        });
        return {
          artifact: {
            kind: "handoff",
            prompt:
              input.locale === "it"
                ? "La richiesta non e chiara. La inoltro all'amministratore."
                : "The request is unclear. I am forwarding it to the administrator.",
            summary,
            notified,
            reason: "unknown_threshold"
          }
        };
      }
      logBookingFunnelStep(input.traceId, {
        step: "unknown_intent",
        locale: input.locale,
        intent: input.parsed.intent
      });
      if (nextUnknownTurnCount >= 2) {
        return {
          artifact: {
            kind: "quick_actions",
            prompt:
              input.locale === "it"
                ? "Non ho capito bene. Cosa vuoi fare?"
                : "I did not fully get it. What would you like to do?",
            items: [
              {
                id: "intent:new",
                title: input.locale === "it" ? "Nuova prenotazione" : "New booking"
              },
              {
                id: "intent:cancel",
                title: input.locale === "it" ? "Annulla prenotazione" : "Cancel booking"
              },
              {
                id: "intent:reschedule",
                title: input.locale === "it" ? "Sposta prenotazione" : "Reschedule booking"
              }
            ]
          }
        };
      }
      return {
        artifact: { kind: "none" },
        outputText:
          input.parsed.replyText ||
          (input.locale === "it"
            ? "Capito. Posso aiutarti con prenotazioni, annullamenti e spostamenti. Scrivi cosa ti serve."
            : "Got it. I can help with bookings, cancellations, and rescheduling. Tell me what you need.")
      };
    }
  }
}

async function resolveBookingLikeIntent(
  input: {
    locale: SupportedLocale;
    tenantConfig: TenantBotConfig;
    session: WhatsAppConversationSession;
    parsed: AiParseResult;
    rawText: string;
    phone: string;
    traceId: string;
  },
  deps: AiOrchestratorDeps
): Promise<{ artifact: ToolArtifact; outputText?: string }> {
  input.session.intent = input.parsed.intent === "new_booking" || input.parsed.intent === "check_availability" ? "new_booking" : "new_booking";

  let services = await deps.fetchServices(input.locale);
  if (
    !input.parsed.serviceQuery &&
    input.parsed.masterQuery &&
    input.parsed.masterQuery.trim().length >= 2
  ) {
    const narrowedServices = await filterServicesByMasterQuery({
      services,
      masterQuery: input.parsed.masterQuery,
      locale: input.locale,
      deps
    });
    if (narrowedServices.length > 0) {
      services = narrowedServices;
    }
    input.session.collectedEntities = {
      ...input.session.collectedEntities,
      masterNameCandidate: input.parsed.masterQuery
    };
  }
  const inferredServiceQuery = inferEntityFromCatalog(input.rawText, services, (item) => item.displayName);
  const effectiveServiceQuery = input.parsed.serviceQuery ?? inferredServiceQuery;
  const effectiveDateText = input.parsed.dateText ?? extractFastDateText(normalizeSearch(input.rawText));
  const effectiveTimeText = input.parsed.timeText ?? extractFastTimeText(normalizeSearch(input.rawText));
  const normalizedDateCandidate = normalizeDateCandidate(
    effectiveDateText,
    input.locale,
    input.tenantConfig.timezone
  );
  const serviceResolution = resolveNamedChoice(services, effectiveServiceQuery, (item) => item.displayName);
  if (!effectiveServiceQuery) {
    input.session.collectedEntities = {
      ...input.session.collectedEntities,
      masterNameCandidate: input.parsed.masterQuery ?? input.session.collectedEntities?.masterNameCandidate,
      dateCandidate: effectiveDateText ?? input.session.collectedEntities?.dateCandidate,
      timeCandidate: effectiveTimeText ?? input.session.collectedEntities?.timeCandidate
    };
    if (normalizedDateCandidate) {
      input.session.date = normalizedDateCandidate;
    }
    logBookingFunnelStep(input.traceId, {
      step: "service_missing",
      locale: input.locale,
      intent: input.parsed.intent
    });
    return {
      artifact: {
        kind: "service_list",
        prompt:
          input.parsed.masterQuery && input.parsed.masterQuery.trim()
            ? input.locale === "it"
              ? `Perfetto, per ${input.parsed.masterQuery.trim()} seleziona prima il servizio.`
              : `Perfect, for ${input.parsed.masterQuery.trim()} please select the service first.`
            : input.locale === "it"
              ? "Seleziona il servizio."
              : "Select a service.",
        items: services.slice(0, 8),
        intent: "new_booking"
      }
    };
  }
  if (serviceResolution.matches.length !== 1) {
    logBookingFunnelStep(input.traceId, {
      step: "service_ambiguous",
      locale: input.locale,
      intent: input.parsed.intent
    });
    return {
      artifact: {
        kind: "service_list",
        prompt:
          input.locale === "it"
            ? "Ho trovato piu servizi. Scegline uno."
            : "I found multiple services. Please choose one.",
        items: (serviceResolution.matches.length > 0 ? serviceResolution.matches : services).slice(0, 8),
        intent: "new_booking"
      }
    };
  }

  const service = serviceResolution.matches[0] as ServiceItem;
  input.session.serviceId = service.id;
  input.session.serviceName = service.displayName;
  input.session.collectedEntities = {
    ...input.session.collectedEntities,
    serviceNameCandidate: effectiveServiceQuery,
    dateCandidate: effectiveDateText ?? input.session.collectedEntities?.dateCandidate,
    timeCandidate: effectiveTimeText ?? input.session.collectedEntities?.timeCandidate
  };
  if (normalizedDateCandidate) {
    input.session.date = normalizedDateCandidate;
  }

  const masters = await deps.fetchMasters(input.locale, service.id);
  const inferredMasterQuery = inferEntityFromCatalog(input.rawText, masters, (item) => item.displayName);
  const effectiveMasterQuery = input.parsed.masterQuery ?? inferredMasterQuery;
  const masterResolution = resolveNamedChoice(masters, effectiveMasterQuery, (item) => item.displayName);
  if (!effectiveMasterQuery) {
    if (masters.length === 1) {
      input.session.masterId = masters[0]?.id;
      input.session.masterName = masters[0]?.displayName;
    } else {
      logBookingFunnelStep(input.traceId, {
        step: "master_missing",
        locale: input.locale,
        intent: input.parsed.intent
      });
      return {
        artifact: {
          kind: "master_list",
          prompt: input.locale === "it" ? "Scegli il master." : "Choose a master.",
          serviceId: service.id,
          serviceName: service.displayName,
          items: masters.slice(0, 8),
          intent: "new_booking"
        }
      };
    }
  } else if (masterResolution.matches.length !== 1) {
    logBookingFunnelStep(input.traceId, {
      step: "master_ambiguous",
      locale: input.locale,
      intent: input.parsed.intent
    });
    return {
      artifact: {
        kind: "master_list",
        prompt:
          input.locale === "it"
            ? "Ho trovato piu master. Scegline uno."
            : "I found multiple masters. Please choose one.",
        serviceId: service.id,
        serviceName: service.displayName,
        items: (masterResolution.matches.length > 0 ? masterResolution.matches : masters).slice(0, 8),
        intent: "new_booking"
      }
    };
  } else {
    const master = masterResolution.matches[0] as MasterItem;
    input.session.masterId = master.id;
    input.session.masterName = master.displayName;
    input.session.collectedEntities = {
      ...input.session.collectedEntities,
      masterNameCandidate: effectiveMasterQuery
    };
  }

  const dateIso = normalizeDateCandidate(effectiveDateText, input.locale, input.tenantConfig.timezone);
  if (!dateIso) {
    logBookingFunnelStep(input.traceId, {
      step: "date_missing",
      locale: input.locale,
      intent: input.parsed.intent
    });
    const dates = await listDatesWithSlots(
      {
        locale: input.locale,
        timezone: input.tenantConfig.timezone,
        serviceId: service.id,
        masterId: input.session.masterId,
        days: 7
      },
      deps
    );
    return {
      artifact: {
        kind: "date_list",
        prompt: input.locale === "it" ? "Scegli una data." : "Choose a date.",
        serviceId: service.id,
        serviceName: service.displayName,
        masterId: input.session.masterId,
        masterName: input.session.masterName,
        items: dates,
        intent: "new_booking"
      }
    };
  }

  input.session.date = dateIso;
  input.session.collectedEntities = {
    ...input.session.collectedEntities,
    dateCandidate: effectiveDateText
  };

  const slots = await deps.fetchSlots({
    serviceId: service.id,
    masterId: input.session.masterId,
    date: dateIso,
    locale: input.locale
  });

  if (slots.length === 0) {
    logBookingFunnelStep(input.traceId, {
      step: "no_slots",
      locale: input.locale,
      intent: input.parsed.intent
    });
    const alternativeDates = await listDatesWithSlots(
      {
        locale: input.locale,
        timezone: input.tenantConfig.timezone,
        serviceId: service.id,
        masterId: input.session.masterId,
        days: 7,
        excludedDate: dateIso
      },
      deps
    );
    return {
      artifact: {
        kind: "date_list",
        prompt:
          input.locale === "it"
            ? "Per questa data non ci sono slot. Scegli un'altra data."
            : "There are no slots for this date. Please choose another date.",
        serviceId: service.id,
        serviceName: service.displayName,
        masterId: input.session.masterId,
        masterName: input.session.masterName,
        items: alternativeDates,
        intent: "new_booking"
      }
    };
  }

  const slotResolution = resolveSlotChoice(slots, effectiveTimeText);
  if (!effectiveTimeText || slotResolution.matches.length !== 1) {
    logBookingFunnelStep(input.traceId, {
      step: "slot_missing",
      locale: input.locale,
      intent: input.parsed.intent
    });
    return {
      artifact: {
        kind: "slot_list",
        prompt: input.locale === "it" ? "Scegli un orario." : "Choose a time.",
        serviceId: service.id,
        serviceName: service.displayName,
        masterId: input.session.masterId,
        masterName: input.session.masterName,
        date: dateIso,
        items: (slotResolution.matches.length > 0 ? slotResolution.matches : slots).slice(0, 8),
        intent: "new_booking"
      }
    };
  }

  const slot = slotResolution.matches[0] as SlotItem;
  input.session.slotStartAt = slot.startAt;
  input.session.slotDisplayTime = slot.displayTime;
  input.session.state = "confirm";
  input.session.currentMode = "ai_assisted";
  input.session.collectedEntities = {
    ...input.session.collectedEntities,
    timeCandidate: effectiveTimeText
  };

  logBookingFunnelStep(input.traceId, {
    step: "confirm_shown",
    locale: input.locale,
    intent: input.parsed.intent
  });

  return {
    artifact: {
      kind: "confirm_booking",
      serviceName: input.session.serviceName,
      masterName: input.session.masterName,
      date: input.session.date,
      slotDisplayTime: input.session.slotDisplayTime
    }
  };
}

async function renderArtifact(
  input: {
    from: string;
    locale: SupportedLocale;
    session: WhatsAppConversationSession;
    artifact: ToolArtifact;
  },
  deps: AiOrchestratorDeps
) {
  switch (input.artifact.kind) {
    case "service_list": {
      if (input.artifact.items.length === 0) {
        await deps.sendText(
          input.from,
          input.locale === "it" ? "Al momento non ci sono servizi disponibili." : "No services are currently available."
        );
        return;
      }
      input.session.currentMode = "ai_assisted";
      input.session.intent = input.artifact.intent ?? input.session.intent ?? "new_booking";
      input.session.state = "choose_service";
      await deps.saveSession(input.from, input.session);
      await deps.sendList(
        input.from,
        input.artifact.prompt,
        input.locale === "it" ? "Servizi" : "Services",
        appendFlowRows(
          input.artifact.items.map((item) => ({
            id: `service:${item.id}`,
            title: truncate(item.displayName, 24),
            description: typeof item.durationMinutes === "number" ? `${item.durationMinutes} min` : undefined
          })),
          input.locale
        )
      );
      return;
    }
    case "master_list": {
      if (input.artifact.items.length === 0) {
        await deps.sendText(
          input.from,
          input.locale === "it" ? "Nessun master disponibile." : "No masters are available."
        );
        return;
      }
      input.session.currentMode = "ai_assisted";
      input.session.intent = input.artifact.intent ?? input.session.intent ?? "new_booking";
      input.session.serviceId = input.artifact.serviceId ?? input.session.serviceId;
      input.session.serviceName = input.artifact.serviceName ?? input.session.serviceName;
      input.session.state = "choose_master";
      await deps.saveSession(input.from, input.session);
      await deps.sendList(
        input.from,
        input.artifact.prompt,
        input.locale === "it" ? "Master" : "Masters",
        appendFlowRows(
          input.artifact.items.map((item) => ({
            id: `master:${item.id}`,
            title: truncate(item.displayName, 24)
          })),
          input.locale
        )
      );
      return;
    }
    case "date_list": {
      if (input.artifact.items.length === 0) {
        await deps.sendText(
          input.from,
          input.locale === "it"
            ? "Non ci sono date disponibili al momento."
            : "There are no available dates right now."
        );
        return;
      }
      input.session.currentMode = "ai_assisted";
      input.session.intent = input.artifact.intent ?? input.session.intent ?? "new_booking";
      input.session.serviceId = input.artifact.serviceId ?? input.session.serviceId;
      input.session.serviceName = input.artifact.serviceName ?? input.session.serviceName;
      input.session.masterId = input.artifact.masterId ?? input.session.masterId;
      input.session.masterName = input.artifact.masterName ?? input.session.masterName;
      input.session.state = "choose_date";
      await deps.saveSession(input.from, input.session);
      await deps.sendList(
        input.from,
        input.artifact.prompt,
        input.locale === "it" ? "Date" : "Dates",
        appendFlowRows(
          input.artifact.items.map((item) => ({
            id: `date:${item.date}`,
            title: truncate(item.title, 24),
            description: item.description
          })),
          input.locale
        )
      );
      return;
    }
    case "slot_list": {
      if (input.artifact.items.length === 0) {
        await deps.sendText(
          input.from,
          input.locale === "it" ? "Non ci sono orari disponibili." : "There are no available times."
        );
        return;
      }
      input.session.currentMode = "ai_assisted";
      input.session.intent = input.artifact.intent ?? input.session.intent ?? "new_booking";
      input.session.serviceId = input.artifact.serviceId ?? input.session.serviceId;
      input.session.serviceName = input.artifact.serviceName ?? input.session.serviceName;
      input.session.masterId = input.artifact.masterId ?? input.session.masterId;
      input.session.masterName = input.artifact.masterName ?? input.session.masterName;
      input.session.date = input.artifact.date;
      input.session.state = "choose_slot";
      await deps.saveSession(input.from, input.session);
      await deps.sendList(
        input.from,
        input.artifact.prompt,
        input.locale === "it" ? "Orari" : "Times",
        appendFlowRows(
          input.artifact.items.map((item) => ({
            id: `slot:${encodeURIComponent(item.startAt)}`,
            title: truncate(item.displayTime, 24)
          })),
          input.locale
        )
      );
      return;
    }
    case "booking_list": {
      if (input.artifact.items.length === 0) {
        await deps.sendButtons(
          input.from,
          input.locale === "it"
            ? "Non ci sono prenotazioni attive da gestire. Cosa vuoi fare?"
            : "There are no active bookings to manage. What would you like to do?",
          buildIntentQuickActions(input.locale).slice(0, 3)
        );
        return;
      }
      input.session.currentMode = "ai_assisted";
      input.session.intent = input.artifact.action === "cancel" ? "cancel_booking" : "reschedule_booking";
      input.session.state =
        input.artifact.action === "cancel" ? "cancel_wait_booking_id" : "reschedule_wait_booking_id";
      await deps.saveSession(input.from, input.session);
      const activeItems = input.artifact.items
        .filter((item) => item.status === "pending" || item.status === "confirmed")
        .sort((left, right) => new Date(left.startAt).getTime() - new Date(right.startAt).getTime());
      const uiMode = activeItems.length <= BOOKING_SELECTION_BUTTONS_MAX_ITEMS ? "buttons" : "list";
      console.info("[bot][ai] booking selection ui", {
        action: input.artifact.action,
        bookingsCount: activeItems.length,
        uiMode,
        locale: input.locale
      });
      if (activeItems.length <= BOOKING_SELECTION_BUTTONS_MAX_ITEMS) {
        const choices: Choice[] = activeItems
          .slice(0, BOOKING_SELECTION_BUTTONS_MAX_ITEMS)
          .map((item) => ({
            id: `booking:${item.id}`,
            title: truncate(formatBookingChoice(item.startAt, input.locale), 24),
            description: item.status
          }));
        choices.push({
          id: BACK_FLOW_TOKEN,
          title: input.locale === "it" ? "Indietro" : "Back"
        });
        await deps.sendButtons(input.from, input.artifact.prompt, choices.slice(0, 3));
        return;
      }
      await deps.sendList(input.from, input.artifact.prompt, input.locale === "it" ? "Prenotazioni" : "Bookings", appendFlowRows(activeItems.map((item) => ({
        id: `booking:${item.id}`,
        title: truncate(formatBookingChoice(item.startAt, input.locale), 24),
        description: item.status
      })), input.locale));
      return;
    }
    case "confirm_booking": {
      input.session.currentMode = "ai_assisted";
      input.session.intent = input.session.intent ?? "new_booking";
      if (!input.session.clientName) {
        input.session.state = "collect_client_name";
        input.session.clientNameInvalidAttempts = 0;
        await deps.saveSession(input.from, input.session);
        await deps.sendText(
          input.from,
          input.locale === "it"
            ? "Perfetto. Ora scrivi il tuo nome e cognome."
            : "Great. Now please type your full name."
        );
        return;
      }
      input.session.state = "confirm";
      await deps.saveSession(input.from, input.session);
      const summary =
        input.locale === "it"
          ? `Confermi prenotazione?\nNome: ${input.session.clientName}\nServizio: ${input.artifact.serviceName ?? "-"}\nMaster: ${input.artifact.masterName ?? "-"}\nData: ${input.artifact.date ?? "-"}\nOrario: ${input.artifact.slotDisplayTime ?? "-"}`
          : `Confirm booking?\nName: ${input.session.clientName}\nService: ${input.artifact.serviceName ?? "-"}\nMaster: ${input.artifact.masterName ?? "-"}\nDate: ${input.artifact.date ?? "-"}\nTime: ${input.artifact.slotDisplayTime ?? "-"}`;
      await deps.sendList(input.from, summary, input.locale === "it" ? "Conferma" : "Confirm", [
        {
          id: "confirm:yes",
          title: input.locale === "it" ? "Conferma" : "Confirm"
        },
        {
          id: "confirm:change",
          title: input.locale === "it" ? "Cambia data" : "Change date"
        },
        {
          id: "confirm:cancel",
          title: input.locale === "it" ? "Annulla" : "Cancel"
        },
        {
          id: BACK_FLOW_TOKEN,
          title: input.locale === "it" ? "Indietro" : "Back"
        },
        {
          id: RESTART_FLOW_TOKEN,
          title: input.locale === "it" ? "Inizio" : "Start over"
        }
      ].slice(0, 10));
      return;
    }
    case "quick_actions": {
      await deps.sendButtons(input.from, input.artifact.prompt, input.artifact.items.slice(0, 3));
      return;
    }
    case "handoff": {
      input.session.currentMode = "human_handoff";
      input.session.handoffStatus = input.artifact.notified ? "active" : "pending";
      input.session.handoffReason = input.artifact.reason;
      input.session.handoffAt = new Date().toISOString();
      if (input.artifact.reason === "complaint" && !input.session.complaintDetectedAt) {
        input.session.complaintDetectedAt = input.session.handoffAt;
      }
      input.session.lastAiSummary = input.artifact.summary;
      await deps.saveSession(input.from, input.session);
      await deps.sendText(input.from, input.artifact.prompt);
      return;
    }
    case "none":
      return;
  }
}

async function listDatesWithSlots(
  input: {
    locale: SupportedLocale;
    timezone: string;
    serviceId: string;
    masterId?: string;
    days: number;
    excludedDate?: string;
  },
  deps: AiOrchestratorDeps
) {
  const dates = buildNextDays(input.timezone, Math.min(Math.max(input.days, 1), 10));
  const items: Array<{ date: string; title: string; description?: string }> = [];
  for (const date of dates) {
    if (date === input.excludedDate) {
      continue;
    }
    const slots = await deps.fetchSlots({
      serviceId: input.serviceId,
      masterId: input.masterId,
      date,
      locale: input.locale
    });
    if (slots.length === 0) {
      continue;
    }
    items.push({
      date,
      title: formatDateLabel(date, input.locale, input.timezone),
      description: input.locale === "it" ? `${slots.length} slot disponibili` : `${slots.length} slots available`
    });
  }
  return items.slice(0, 8);
}

function buildNextDays(timezone: string, count: number) {
  const out: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const date = new Date(Date.now() + index * 24 * 60 * 60 * 1000);
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date);
    const year = parts.find((item) => item.type === "year")?.value;
    const month = parts.find((item) => item.type === "month")?.value;
    const day = parts.find((item) => item.type === "day")?.value;
    if (year && month && day) {
      out.push(`${year}-${month}-${day}`);
    }
  }
  return Array.from(new Set(out));
}

function formatDateLabel(dateIso: string, locale: SupportedLocale, timezone: string) {
  return new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    timeZone: timezone
  }).format(new Date(`${dateIso}T00:00:00.000Z`));
}

function formatBookingChoice(startAtIso: string, locale: SupportedLocale) {
  return new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(startAtIso));
}

function resolveNamedChoice<T>(items: T[], query: string | undefined, readLabel: (item: T) => string) {
  if (!query?.trim()) {
    return { matches: [] as T[] };
  }
  return {
    matches: findMatches(items, query, readLabel)
  };
}

function findMatches<T>(items: T[], query: string | undefined, readLabel: (item: T) => string) {
  if (!query?.trim()) {
    return [];
  }
  const normalized = normalizeSearch(query);
  const exact = items.filter((item) => normalizeSearch(readLabel(item)) === normalized);
  if (exact.length > 0) {
    return exact;
  }
  return items.filter((item) => normalizeSearch(readLabel(item)).includes(normalized));
}

function resolveSlotChoice(slots: SlotItem[], timeText: string | undefined) {
  if (!timeText?.trim()) {
    return { matches: [] as SlotItem[] };
  }
  const normalizedTime = normalizeTimeCandidate(timeText);
  if (!normalizedTime) {
    return { matches: [] as SlotItem[] };
  }
  const exact = slots.filter((item) => normalizeTimeCandidate(item.displayTime) === normalizedTime);
  if (exact.length > 0) {
    return { matches: exact };
  }
  return {
    matches: slots.filter((item) => normalizeSearch(item.displayTime).includes(normalizedTime))
  };
}

function normalizeDateCandidate(
  value: string | undefined,
  locale: SupportedLocale,
  timezone: string
): string | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  const normalized = normalizeSearch(value);
  const nextDays = buildNextDays(timezone, 14);
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return normalized;
  }
  if (normalized === "today" || normalized === "oggi") {
    return nextDays[0];
  }
  if (normalized === "tomorrow" || normalized === "domani") {
    return nextDays[1];
  }
  const weekdayIndex = mapWeekday(normalized, locale);
  if (weekdayIndex === undefined) {
    return undefined;
  }
  return nextDays.find((date) => getWeekdayIndex(date, timezone) === weekdayIndex);
}

function mapWeekday(value: string, locale: SupportedLocale) {
  const enMap: Record<string, number> = {
    monday: 1,
    mon: 1,
    tuesday: 2,
    tue: 2,
    wednesday: 3,
    wed: 3,
    thursday: 4,
    thu: 4,
    friday: 5,
    fri: 5,
    saturday: 6,
    sat: 6,
    sunday: 0,
    sun: 0
  };
  const itMap: Record<string, number> = {
    lunedi: 1,
    lun: 1,
    martedi: 2,
    mar: 2,
    mercoledi: 3,
    mer: 3,
    giovedi: 4,
    gio: 4,
    venerdi: 5,
    ven: 5,
    sabato: 6,
    sab: 6,
    domenica: 0,
    dom: 0
  };
  return locale === "it" ? itMap[value] : enMap[value];
}

function getWeekdayIndex(dateIso: string, timezone: string) {
  const weekday = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: timezone
  }).format(new Date(`${dateIso}T00:00:00.000Z`));
  return mapWeekday(weekday.toLowerCase(), "en");
}

function normalizeTimeCandidate(value: string) {
  const normalized = value.trim().toLowerCase();
  const match = normalized.match(/(\d{1,2})(?::?(\d{2}))?\s*(am|pm)?/);
  if (!match) {
    return undefined;
  }
  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? "00");
  const suffix = match[3];
  if (Number.isNaN(hours) || Number.isNaN(minutes) || minutes > 59) {
    return undefined;
  }
  if (suffix === "pm" && hours < 12) {
    hours += 12;
  }
  if (suffix === "am" && hours === 12) {
    hours = 0;
  }
  if (hours > 23) {
    return undefined;
  }
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function extractJsonObject(value: string): Record<string, unknown> | null {
  const trimmed = value.trim();
  const direct = safeJsonParse(trimmed);
  if (direct) {
    return direct;
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  return safeJsonParse(trimmed.slice(start, end + 1));
}

function safeJsonParse(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return typeof parsed === "object" && parsed ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeAiParseResult(payload: Record<string, unknown>, locale: SupportedLocale): AiParseResult {
  const rawIntent = asOptionalString(payload.intent) ?? "unknown";
  const rawConfidence = asOptionalString(payload.confidence) ?? "low";
  const schemaVersion = asOptionalString(payload.schema_version);
  return {
    schemaVersion,
    intent: isParsedIntent(rawIntent) ? rawIntent : "unknown",
    confidence: rawConfidence === "high" || rawConfidence === "medium" ? rawConfidence : "low",
    serviceQuery: asOptionalString(payload.service_query),
    masterQuery: asOptionalString(payload.master_query),
    dateText: asOptionalString(payload.date_text),
    timeText: asOptionalString(payload.time_text),
    bookingReference: asOptionalString(payload.booking_reference),
    replyText:
      asOptionalString(payload.reply_text) ||
      (locale === "it" ? "Posso aiutarti con prenotazioni, annullamenti e spostamenti." : "I can help with bookings, cancellations, and rescheduling."),
    handoffSummary: asOptionalString(payload.handoff_summary)
  };
}

function isParsedIntent(value: string): value is ParsedIntent {
  return [
    "new_booking",
    "cancel_booking",
    "reschedule_booking",
    "booking_list",
    "catalog",
    "check_availability",
    "price_info",
    "address_info",
    "parking_info",
    "working_hours_info",
    "human_handoff",
    "unknown"
  ].includes(value);
}

function detectFastPathIntent(text: string, locale: SupportedLocale): AiParseResult | null {
  if (isLikelyNoiseInput(text)) {
    return {
      intent: "unknown",
      confidence: "high",
      replyText:
        locale === "it"
          ? "Messaggio non chiaro. Scegli un'azione."
          : "Message not clear. Please choose an action."
    };
  }
  const normalized = normalizeSearch(text);
  if (!normalized) {
    return null;
  }
  if (hasComplaintSignal(normalized)) {
    return {
      intent: "human_handoff",
      confidence: "high",
      replyText:
        locale === "it"
          ? "Mi dispiace per il problema. Ti metto subito in contatto con l'amministratore."
          : "I am sorry about the issue. I will connect you with the administrator right away.",
      handoffSummary: text.trim().slice(0, 240)
    };
  }
  const extractedDate = extractFastDateText(normalized);
  const extractedTime = extractFastTimeText(normalized);
  const hasBookingSignals = hasBookingSignal(normalized) || Boolean(extractedDate) || Boolean(extractedTime);

  if (/\b(human|operator|person|admin|support|operatore|umano|assistenza|amministratore)\b/.test(normalized)) {
    return {
      intent: "human_handoff",
      confidence: "high",
      replyText: undefined,
      handoffSummary: text.trim().slice(0, 240)
    };
  }

  if (
    /\b(cancel|cancel booking|cancel appointment|annulla|annullare|disdici|elimina prenotazione)\b/.test(normalized) &&
    !/[0-9a-f]{8}-/i.test(normalized)
  ) {
    return {
      intent: "cancel_booking",
      confidence: "high",
      replyText: locale === "it" ? "Scegli la prenotazione da annullare." : "Choose the booking to cancel."
    };
  }

  if (
    /\b(reschedule|move booking|move appointment|change booking|change appointment|sposta|spostare|riprogramma|cambia prenotazione)\b/.test(
      normalized
    )
  ) {
    return {
      intent: "reschedule_booking",
      confidence: "high",
      replyText: locale === "it" ? "Scegli la prenotazione da spostare." : "Choose the booking to reschedule."
    };
  }

  if (hasBookingListSignal(normalized)) {
    return {
      intent: "booking_list",
      confidence: "high",
      replyText:
        locale === "it"
          ? "Ecco le tue prenotazioni attive."
          : "Here are your active bookings."
    };
  }

  if (/\b(price|prices|cost|how much|quanto costa|prezzo|prezzi|tariffa)\b/.test(normalized)) {
    return {
      intent: "price_info",
      confidence: "high",
      replyText: locale === "it" ? "Ti invio le informazioni sui prezzi." : "I will share pricing details."
    };
  }

  if (/\b(address|where are you|location|indirizzo|dove siete|dove siete ubicati)\b/.test(normalized)) {
    return {
      intent: "address_info",
      confidence: "high",
      replyText: locale === "it" ? "Ti invio l'indirizzo." : "I will share the address."
    };
  }

  if (/\b(parking|park|parcheggio|posto auto)\b/.test(normalized)) {
    return {
      intent: "parking_info",
      confidence: "high",
      replyText: locale === "it" ? "Ti invio le informazioni sul parcheggio." : "I will share parking information."
    };
  }

  if (/\b(hours|opening hours|working hours|orari|orario|quando siete aperti)\b/.test(normalized)) {
    return {
      intent: "working_hours_info",
      confidence: "high",
      replyText: locale === "it" ? "Ti invio gli orari." : "I will share working hours."
    };
  }

  if (isCatalogOnlyQuery(normalized) && !hasBookingSignals) {
    return {
      intent: "catalog",
      confidence: "high",
      replyText: locale === "it" ? "Seleziona il servizio." : "Select a service."
    };
  }

  if (
    hasBookingSignal(normalized) ||
    (/\b(service|servizio|appointment|appuntamento)\b/.test(normalized) && (Boolean(extractedDate) || Boolean(extractedTime)))
  ) {
    return {
      intent: "new_booking",
      confidence: "high",
      dateText: extractedDate,
      timeText: extractedTime,
      replyText: locale === "it" ? "Seleziona il servizio." : "Select a service."
    };
  }

  if (/^(hi|hello|hey|ciao|salve|buongiorno|buonasera)$/.test(normalized)) {
    return {
      intent: "unknown",
      confidence: "high",
      replyText:
        locale === "it"
          ? "Ciao. Posso aiutarti con prenotazioni, annullamenti e spostamenti."
          : "Hi. I can help with bookings, cancellations, and rescheduling."
    };
  }

  if (
    /\b(what can you do|help me|help|how does it work|can you help|come funziona|aiutami|che puoi fare|cosa puoi fare)\b/.test(
      normalized
    )
  ) {
    return {
      intent: "unknown",
      confidence: "high",
      replyText:
        locale === "it"
          ? "Posso aiutarti con prenotazioni, annullamenti e spostamenti."
          : "I can help with bookings, cancellations, and rescheduling."
    };
  }

  if (/\b(availability|available|free slot|orari liberi|disponibilita|disponibile|posto libero)\b/.test(normalized)) {
    return {
      intent: "check_availability",
      confidence: "medium",
      dateText: extractedDate,
      timeText: extractedTime
    };
  }

  if (extractedDate || extractedTime) {
    return {
      intent: "check_availability",
      confidence: "medium",
      dateText: extractedDate,
      timeText: extractedTime
    };
  }

  return null;
}

function normalizeParsedIntentWithHeuristics(parsed: AiParseResult, text: string, locale: SupportedLocale): AiParseResult {
  const normalized = normalizeSearch(text);
  const hasPriceInfo = /\b(price|prices|cost|how much|quanto costa|prezzo|prezzi|tariffa)\b/.test(normalized);
  const hasAddressInfo = /\b(address|where are you|location|indirizzo|dove siete|dove siete ubicati)\b/.test(normalized);
  const hasParkingInfo = /\b(parking|park|parcheggio|posto auto)\b/.test(normalized);
  const hasHoursInfo = /\b(hours|opening hours|working hours|orari|orario|quando siete aperti)\b/.test(normalized);
  if (hasComplaintSignal(normalized)) {
    return {
      ...parsed,
      intent: "human_handoff",
      confidence: "high",
      replyText:
        locale === "it"
          ? "Mi dispiace per il problema. Ti metto subito in contatto con l'amministratore."
          : "I am sorry about the issue. I will connect you with the administrator right away.",
      handoffSummary: text.trim().slice(0, 240)
    };
  }
  const hasCancel = /\b(cancel|cancel booking|cancel appointment|annulla|annullare|disdici|elimina prenotazione)\b/.test(normalized);
  const hasReschedule =
    /\b(reschedule|move booking|move appointment|change booking|change appointment|sposta|spostare|riprogramma|cambia prenotazione)\b/.test(
      normalized
    );
  const hasBookingList = hasBookingListSignal(normalized);
  const extractedDate = parsed.dateText ?? extractFastDateText(normalized);
  const extractedTime = parsed.timeText ?? extractFastTimeText(normalized);
  const bookingSignal = hasBookingSignal(normalized);

  if (hasPriceInfo) {
    return { ...parsed, intent: "price_info", confidence: "high" };
  }
  if (hasAddressInfo) {
    return { ...parsed, intent: "address_info", confidence: "high" };
  }
  if (hasParkingInfo) {
    return { ...parsed, intent: "parking_info", confidence: "high" };
  }
  if (hasHoursInfo) {
    return { ...parsed, intent: "working_hours_info", confidence: "high" };
  }

  if (hasCancel) {
    return {
      ...parsed,
      intent: "cancel_booking",
      confidence: "high",
      replyText: locale === "it" ? "Ok, procediamo con l'annullamento." : "Okay, let's proceed with cancellation."
    };
  }

  if (hasReschedule) {
    return {
      ...parsed,
      intent: "reschedule_booking",
      confidence: "high",
      replyText:
        locale === "it" ? "Ok, procediamo con lo spostamento." : "Okay, let's proceed with rescheduling."
    };
  }

  if (hasBookingList && !bookingSignal) {
    return {
      ...parsed,
      intent: "booking_list",
      confidence: parsed.confidence === "low" ? "medium" : parsed.confidence,
      replyText:
        locale === "it"
          ? "Ecco le tue prenotazioni attive."
          : "Here are your active bookings."
    };
  }

  if (
    parsed.intent === "catalog" &&
    (bookingSignal || Boolean(extractedDate) || Boolean(extractedTime) || Boolean(parsed.masterQuery) || Boolean(parsed.serviceQuery))
  ) {
    return {
      ...parsed,
      intent: bookingSignal ? "new_booking" : "check_availability",
      confidence: parsed.confidence === "high" ? "medium" : parsed.confidence,
      dateText: extractedDate,
      timeText: extractedTime,
      replyText: locale === "it" ? "Va bene, iniziamo con la prenotazione." : "Got it, let's start your booking."
    };
  }

  if (parsed.intent === "catalog" && !isCatalogOnlyQuery(normalized)) {
    return {
      ...parsed,
      intent: bookingSignal || extractedDate || extractedTime ? "new_booking" : "unknown",
      confidence: "medium",
      dateText: extractedDate,
      timeText: extractedTime
    };
  }

  if (parsed.intent === "unknown") {
    if (hasBookingList && !bookingSignal) {
      return {
        ...parsed,
        intent: "booking_list",
        confidence: "medium",
        replyText:
          locale === "it"
            ? "Ecco le tue prenotazioni attive."
            : "Here are your active bookings."
      };
    }
    if (bookingSignal || extractedDate || extractedTime) {
      return {
        ...parsed,
        intent: "new_booking",
        confidence: "medium",
        dateText: extractedDate,
        timeText: extractedTime,
        replyText: locale === "it" ? "Perfetto, troviamo uno slot." : "Great, let's find an available slot."
      };
    }
  }

  return parsed;
}

function buildSessionSummary(session: WhatsAppConversationSession, parsed: AiParseResult) {
  return [
    `intent=${parsed.intent}`,
    `service=${session.serviceName ?? parsed.serviceQuery ?? "none"}`,
    `master=${session.masterName ?? parsed.masterQuery ?? "none"}`,
    `date=${session.date ?? parsed.dateText ?? "none"}`,
    `time=${session.slotDisplayTime ?? parsed.timeText ?? "none"}`
  ].join("; ").slice(0, 280);
}

function resolveFaqAnswer(
  tenantConfig: TenantBotConfig,
  locale: SupportedLocale,
  intent: Extract<ParsedIntent, "price_info" | "address_info" | "parking_info" | "working_hours_info">
) {
  const current = locale === "it" ? tenantConfig.faqContent?.it : tenantConfig.faqContent?.en;
  const fallback = locale === "it" ? tenantConfig.faqContent?.en : tenantConfig.faqContent?.it;
  switch (intent) {
    case "price_info":
      return current?.priceInfo?.trim() || fallback?.priceInfo?.trim() || "";
    case "address_info":
      return current?.addressInfo?.trim() || fallback?.addressInfo?.trim() || "";
    case "parking_info":
      return current?.parkingInfo?.trim() || fallback?.parkingInfo?.trim() || "";
    case "working_hours_info":
      return current?.workingHoursInfo?.trim() || fallback?.workingHoursInfo?.trim() || "";
    default:
      return "";
  }
}

function normalizeSearch(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function buildDayKey(timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

async function getCatalogHints(input: {
  tenantKey: string;
  locale: SupportedLocale;
  deps: Pick<AiOrchestratorDeps, "fetchServices" | "fetchMasters">;
}) {
  const cacheKey = `${input.tenantKey}:${input.locale}`;
  const cached = catalogHintsCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CATALOG_HINTS_CACHE_TTL_MS) {
    return {
      services: cached.services,
      masters: cached.masters
    };
  }

  try {
    const [services, masters] = await Promise.all([
      input.deps.fetchServices(input.locale),
      input.deps.fetchMasters(input.locale)
    ]);
    const next = {
      services: services.map((item) => item.displayName).filter(Boolean).slice(0, 10),
      masters: masters.map((item) => item.displayName).filter(Boolean).slice(0, 10),
      ts: Date.now()
    };
    catalogHintsCache.set(cacheKey, next);
    return {
      services: next.services,
      masters: next.masters
    };
  } catch {
    return {
      services: [],
      masters: []
    };
  }
}

function logBookingFunnelStep(
  traceId: string,
  input: {
    step:
      | "service_missing"
      | "service_ambiguous"
      | "master_missing"
      | "master_ambiguous"
      | "date_missing"
      | "slot_missing"
      | "no_slots"
      | "confirm_shown"
      | "cancel_selection_shown"
      | "reschedule_selection_shown"
      | "no_active_bookings"
      | "unknown_intent";
    locale: SupportedLocale;
    intent: ParsedIntent;
  }
) {
  console.info("[bot][ai] booking funnel step", {
    traceId,
    step: input.step,
    locale: input.locale,
    intent: input.intent
  });
}

function logSessionHealth(traceId: string, session: WhatsAppConversationSession) {
  console.info("[bot][ai] session health", {
    traceId,
    state: session.state,
    currentMode: session.currentMode ?? "deterministic",
    aiFailureCount: session.aiFailureCount ?? 0,
    unknownTurnCount: session.unknownTurnCount ?? 0,
    aiCallsInSession: session.aiCallsInSession ?? 0
  });
}

function hasBookingSignal(normalizedText: string) {
  return /\b(book|booking|book appointment|new booking|reserve|reservation|appointment|appointments|i need appointment|i want appointment|book me|i want to book|i need a booking|prenota|prenotazione|prenotazioni|voglio prenotare|vorrei prenotare|devo prenotare|prenotami|fissare appuntamento|appuntamento|appuntamenti)\b/.test(
    normalizedText
  );
}

function hasComplaintSignal(normalizedText: string) {
  return /\b(complaint|angry|upset|bad service|terrible|ridiculous|frustrat|not happy|disappointed|reclamo|arrabbiat|insoddisfatt|servizio pessimo|pessimo|scandaloso|vergogna)\b/.test(
    normalizedText
  );
}

function hasBookingListSignal(normalizedText: string) {
  return /\b(my bookings|my booking|my appointments|my appointment|show my bookings|show my appointments|what bookings do i have|what appointments do i have|do i have bookings|do i have appointments|le mie prenotazioni|mie prenotazioni|quali prenotazioni ho|quali appuntamenti ho|le mie visite|i miei appuntamenti|mostra le mie prenotazioni|mostra i miei appuntamenti|мои записи|какие у меня записи|мои брони)\b/.test(
    normalizedText
  );
}

function isCatalogOnlyQuery(normalizedText: string) {
  return /^(what services( do you have)?|show( me)? (services|catalog)|services|service list|catalog|servizi|elenco servizi|catalogo|quali servizi|quali servizi avete|che servizi avete)\??$/.test(
    normalizedText
  );
}

export function detectTransportFallbackIntent(text: string, locale: SupportedLocale): AiParseResult | null {
  const normalized = normalizeSearch(text);
  const extractedDate = extractFastDateText(normalized);
  const extractedTime = extractFastTimeText(normalized);

  if (hasBookingListSignal(normalized)) {
    return {
      intent: "booking_list",
      confidence: "medium",
      replyText:
        locale === "it"
          ? "Ecco le tue prenotazioni attive."
          : "Here are your active bookings."
    };
  }

  if (/\b(cancel|annulla|disdici)\b/.test(normalized)) {
    return {
      intent: "cancel_booking",
      confidence: "medium",
      replyText: locale === "it" ? "Procediamo con l'annullamento." : "Let's continue with cancellation."
    };
  }
  if (/\b(reschedule|sposta|spostare|riprogramma|cambia prenotazione|change booking)\b/.test(normalized)) {
    return {
      intent: "reschedule_booking",
      confidence: "medium",
      replyText: locale === "it" ? "Procediamo con lo spostamento." : "Let's continue with rescheduling."
    };
  }
  if (isCatalogOnlyQuery(normalized)) {
    return {
      intent: "catalog",
      confidence: "medium"
    };
  }
  if (hasBookingSignal(normalized)) {
    return {
      intent: "new_booking",
      confidence: "medium",
      dateText: extractedDate,
      timeText: extractedTime,
      replyText: locale === "it" ? "Procediamo con la prenotazione." : "Let's continue with booking."
    };
  }
  if (extractedDate || extractedTime) {
    return {
      intent: "check_availability",
      confidence: "low",
      dateText: extractedDate,
      timeText: extractedTime
    };
  }
  return null;
}

function mergeLocalFastPaths(
  transportFallback: AiParseResult | null,
  catalogAssisted: AiParseResult | null
): AiParseResult | null {
  if (!transportFallback && !catalogAssisted) {
    return null;
  }
  if (!transportFallback) {
    return catalogAssisted;
  }
  if (!catalogAssisted) {
    return transportFallback;
  }

  if (
    (transportFallback.intent === "new_booking" || transportFallback.intent === "check_availability") &&
    (catalogAssisted.serviceQuery || catalogAssisted.masterQuery)
  ) {
    return {
      ...transportFallback,
      ...catalogAssisted,
      intent: "new_booking",
      confidence: "high"
    };
  }
  return transportFallback;
}

function detectCatalogAssistedFastPath(
  text: string,
  locale: SupportedLocale,
  catalogHints: { services: string[]; masters: string[] }
): AiParseResult | null {
  const normalized = normalizeSearch(text);
  if (!normalized) {
    return null;
  }

  const serviceMatch = findCatalogHintMatch(normalized, catalogHints.services);
  const masterMatch = findCatalogHintMatch(normalized, catalogHints.masters);
  if (!serviceMatch && !masterMatch) {
    return null;
  }

  const extractedDate = extractFastDateText(normalized);
  const extractedTime = extractFastTimeText(normalized);
  return {
    intent: "new_booking",
    confidence: serviceMatch ? "high" : "medium",
    serviceQuery: serviceMatch ?? undefined,
    masterQuery: masterMatch ?? undefined,
    dateText: extractedDate,
    timeText: extractedTime,
    replyText: locale === "it" ? "Perfetto, continuo con la prenotazione." : "Perfect, I will continue with booking."
  };
}

function findCatalogHintMatch(normalizedText: string, hints: string[]): string | null {
  let bestHint: string | null = null;
  let bestScore = 0;
  for (const hint of hints) {
    const normalizedHint = normalizeSearch(hint);
    if (!normalizedHint) {
      continue;
    }
    if (normalizedText.includes(normalizedHint)) {
      return hint;
    }
    const tokens = normalizedHint.split(" ").filter((token) => token.length >= 4);
    if (tokens.length === 0) {
      continue;
    }
    let matched = 0;
    for (const token of tokens) {
      if (normalizedText.includes(token)) {
        matched += 1;
      }
    }
    if (matched > 0 && matched > bestScore) {
      bestScore = matched;
      bestHint = hint;
    }
  }
  return bestHint;
}

function extractFastDateText(value: string) {
  const match = value.match(
    /\b(today|tomorrow|oggi|domani|monday|tuesday|wednesday|thursday|friday|saturday|sunday|lunedi|martedi|mercoledi|giovedi|venerdi|sabato|domenica)\b/
  );
  return match?.[1];
}

function extractFastTimeText(value: string) {
  const match = value.match(/\b(\d{1,2}(?::\d{2})?\s?(?:am|pm)?)\b/);
  return match?.[1];
}

async function filterServicesByMasterQuery(input: {
  services: ServiceItem[];
  masterQuery: string;
  locale: SupportedLocale;
  deps: Pick<AiOrchestratorDeps, "fetchMasters">;
}) {
  const normalizedQuery = normalizeSearch(input.masterQuery);
  if (!normalizedQuery) {
    return input.services;
  }

  const matched: ServiceItem[] = [];
  for (const service of input.services) {
    try {
      const masters = await input.deps.fetchMasters(input.locale, service.id);
      const hasMatch = masters.some((master) =>
        normalizeSearch(master.displayName).includes(normalizedQuery)
      );
      if (hasMatch) {
        matched.push(service);
      }
    } catch {
      // Ignore single service lookup failures and continue with best-effort narrowing.
    }
  }
  return matched;
}

function isLikelyNoiseInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return true;
  }
  if (/^[!?.,:\-_/\\|~`'"*+=(){}\[\]<>#%^&$@]+$/.test(trimmed)) {
    return true;
  }
  const normalized = normalizeSearch(trimmed);
  if (!normalized) {
    return true;
  }
  if (normalized.length <= 2) {
    return true;
  }
  if (/^([a-zа-яё])\1{3,}$/i.test(normalized)) {
    return true;
  }
  return false;
}

function inferEntityFromCatalog<T>(
  rawText: string,
  items: T[],
  readLabel: (item: T) => string
): string | undefined {
  const normalizedText = normalizeSearch(rawText);
  if (!normalizedText) {
    return undefined;
  }

  const candidates = items.filter((item) => {
    const label = normalizeSearch(readLabel(item));
    return label.length > 2 && normalizedText.includes(label);
  });
  if (candidates.length !== 1) {
    return undefined;
  }
  return readLabel(candidates[0] as T);
}

function appendFlowRows(choices: Choice[], locale: SupportedLocale) {
  return [
    ...choices.slice(0, 8),
    {
      id: BACK_FLOW_TOKEN,
      title: locale === "it" ? "Indietro" : "Back"
    },
    {
      id: RESTART_FLOW_TOKEN,
      title: locale === "it" ? "Inizio" : "Start over"
    }
  ].slice(0, 10);
}

function buildIntentQuickActions(locale: SupportedLocale): Choice[] {
  return [
    {
      id: "intent:new",
      title: locale === "it" ? "Nuova prenotazione" : "New booking"
    },
    {
      id: "intent:cancel",
      title: locale === "it" ? "Annulla prenotazione" : "Cancel booking"
    },
    {
      id: "intent:reschedule",
      title: locale === "it" ? "Sposta prenotazione" : "Reschedule booking"
    }
  ];
}

function truncate(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function sanitizeUserText(value: string) {
  return value
    .replace(/\b(?:code|codice)\b\s*:\s*[^\n]+/gi, "")
    .replace(/\n{2,}/g, "\n")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 280);
}

function sanitizeHandoffSummary(value: string) {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, "[phone]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function normalizeInboundUserText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function asOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function classifyAiError(error: unknown) {
  if (error instanceof OpenAIResponsesError) {
    return "openai_transport_error";
  }
  if (error instanceof Error && error.message === "ai_parse_invalid_json") {
    return "ai_parse_error";
  }
  return "tool_domain_error";
}

function isOpenAiQuotaError(error: unknown) {
  if (!(error instanceof OpenAIResponsesError)) {
    return false;
  }
  const message = String(error.message || "").toLowerCase();
  return message.includes("insufficient_quota") || message.includes("exceeded your current quota");
}

function maskPhone(value: string): string {
  const normalized = value.replace(/\s+/g, "");
  if (normalized.length <= 4) {
    return "***";
  }
  return `${normalized.slice(0, 3)}***${normalized.slice(-2)}`;
}
