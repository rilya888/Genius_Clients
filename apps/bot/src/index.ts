import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { resolveLocale, t, type SupportedLocale } from "@genius/i18n";
import {
  captureException,
  createBookingActionToken,
  verifyBookingActionToken,
  type BookingActionType
} from "@genius/shared";
import Redis from "ioredis";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import {
  createInitialSession,
  migrateWhatsAppSession,
  processWhatsAppConversation,
  type WhatsAppConversationSession
} from "./whatsapp-conversation";
import { detectTransportFallbackIntent, processAiWhatsAppMessage } from "./ai-orchestrator";
import { OpenAIResponsesClient } from "./openai-responses-client";
import { applyConversationResetPolicy, toDeterministicIntentToken } from "./conversation-reset-policy";
import { resolveConversationLocale } from "./conversation-locale";
import {
  resolveChannelRouteFromApi,
  resolveLegacyBotRoute,
  type BotRoutingContext
} from "./enterprise/channel-routing";
import { buildScopedSessionKey, getRoutingScopeSegment } from "./enterprise/session-scope";
import {
  normalizeTenantFlowConfig,
  normalizeTenantTerminologyConfig
} from "./tenant-terminology";
import {
  maskIdentifier,
  maskPhone,
  redactLogString,
  sanitizeAlertContext,
  toLogError
} from "./log-safety";

const app = new Hono();
const telegramWebhookSecret = process.env.TG_WEBHOOK_SECRET_TOKEN ?? "";
const telegramBotToken = process.env.TG_BOT_TOKEN ?? "";
const waPhoneNumberId = process.env.WA_PHONE_NUMBER_ID ?? "";
const waAccessToken = process.env.WA_ACCESS_TOKEN ?? "";
const waAccessTokenByPhoneRaw = process.env.WA_ACCESS_TOKEN_BY_PHONE_JSON ?? "";
const waVerifyToken = process.env.WA_VERIFY_TOKEN ?? "";
const waWebhookSecret = process.env.WA_WEBHOOK_SECRET ?? "";
const waActionTokenSecret = process.env.WA_ACTION_TOKEN_SECRET ?? "";
const openAiApiKey = process.env.OPENAI_API_KEY ?? "";
const openAiModel = process.env.OPENAI_MODEL ?? "gpt-5-mini";
const openAiResponsesEnabled = process.env.OPENAI_RESPONSES_ENABLED !== "false";
const openAiCanaryTenants = (process.env.OPENAI_CANARY_TENANTS ?? "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const openAiMaxCallsPerSession = Math.max(1, Number.parseInt(process.env.OPENAI_MAX_CALLS_PER_SESSION ?? "12", 10) || 12);
const openAiMaxCallsPerDay = Math.max(1, Number.parseInt(process.env.OPENAI_MAX_CALLS_PER_DAY_PER_TENANT ?? "500", 10) || 500);
const aiFailureHandoffThreshold = Math.max(1, Number.parseInt(process.env.AI_FAILURE_HANDOFF_THRESHOLD ?? "3", 10) || 3);
const unknownTurnHandoffThreshold = Math.max(1, Number.parseInt(process.env.UNKNOWN_TURN_HANDOFF_THRESHOLD ?? "3", 10) || 3);
const unknownTenantAlertWindowSeconds = Math.max(
  60,
  Number.parseInt(process.env.UNKNOWN_TENANT_ALERT_WINDOW_SECONDS ?? "3600", 10) || 3600
);
const unknownTenantAlertThreshold = Math.max(
  1,
  Number.parseInt(process.env.UNKNOWN_TENANT_ALERT_THRESHOLD ?? "50", 10) || 50
);
const rateLimitWindowSeconds = Math.max(10, Number.parseInt(process.env.RATE_LIMIT_WINDOW_SECONDS ?? "60", 10) || 60);
const rateLimitMaxMessages = Math.max(1, Number.parseInt(process.env.RATE_LIMIT_MAX_MESSAGES ?? "20", 10) || 20);
const tenantRateLimitWindowSeconds = Math.max(
  10,
  Number.parseInt(process.env.TENANT_RATE_LIMIT_WINDOW_SECONDS ?? "60", 10) || 60
);
const tenantRateLimitMaxMessages = Math.max(
  1,
  Number.parseInt(process.env.TENANT_RATE_LIMIT_MAX_MESSAGES ?? "500", 10) || 500
);
const waOutboundRetryAttempts = Math.max(
  0,
  Number.parseInt(process.env.WA_OUTBOUND_RETRY_ATTEMPTS ?? "3", 10) || 3
);
const waOutboundRetryBaseDelayMs = Math.max(
  100,
  Number.parseInt(process.env.WA_OUTBOUND_RETRY_BASE_DELAY_MS ?? "500", 10) || 500
);
const waOutboundStateTtlSeconds = Math.max(
  1800,
  Number.parseInt(process.env.WA_OUTBOUND_STATE_TTL_SECONDS ?? "21600", 10) || 21600
);
const adminRejectReasonTtlSeconds = Math.max(
  120,
  Number.parseInt(process.env.WA_ADMIN_REJECT_REASON_TTL_SECONDS ?? "600", 10) || 600
);
const sessionIdleResetMinutes = Math.max(1, Number.parseInt(process.env.SESSION_IDLE_RESET_MINUTES ?? "45", 10) || 45);
const sessionRedisTtlSeconds = Math.max(
  60 * 60,
  Number.parseInt(process.env.SESSION_REDIS_TTL_SECONDS ?? String((sessionIdleResetMinutes + 60) * 60), 10) ||
    (sessionIdleResetMinutes + 60) * 60
);
const botLateCancelWarnHours = Math.max(0, Number.parseInt(process.env.BOT_LATE_CANCEL_WARN_HOURS ?? "24", 10) || 24);
const botLateCancelBlockHours = Math.max(0, Number.parseInt(process.env.BOT_LATE_CANCEL_BLOCK_HOURS ?? "0", 10) || 0);
const opsAlertWebhookUrl = process.env.OPS_ALERT_WEBHOOK_URL ?? "";
const opsAlertWebhookToken = process.env.OPS_ALERT_WEBHOOK_TOKEN ?? "";
const apiUrl = process.env.API_URL ?? "";
const webUrl = (
  process.env.WEB_URL ??
  process.env.APP_URL ??
  process.env.RAILWAY_SERVICE_WEB_URL ??
  ""
).trim();
const internalApiSecret = process.env.INTERNAL_API_SECRET ?? "";
const botTenantSlug = process.env.BOT_TENANT_SLUG ?? "";
const botTenantId = process.env.BOT_TENANT_ID ?? "";
const waEnterpriseRoutingRequired = process.env.WA_ENTERPRISE_ROUTING_REQUIRED === "true";
const redisUrl = process.env.REDIS_URL?.trim();
const redis = redisUrl
  ? new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false
    })
  : null;
if (redis) {
  redis.on("error", (error) => {
    console.error("[bot] redis client error", {
      error: toLogError(error)
    });
  });
}

type RuntimeCounterKey =
  | "inboundMessages"
  | "aiHandled"
  | "deterministicHandled"
  | "ctaHandled"
  | "adminDigestHandled"
  | "adminDigestErrors"
  | "nonTextHandled"
  | "fallbackTextHandled"
  | "processingErrors"
  | "unknownIntentHandled"
  | "handoffEscalations"
  | "complaintSignalsDetected"
  | "complaintHandoffs";

const runtimeStats = {
  startedAt: new Date().toISOString(),
  inboundMessages: 0,
  aiHandled: 0,
  deterministicHandled: 0,
  ctaHandled: 0,
  adminDigestHandled: 0,
  adminDigestErrors: 0,
  nonTextHandled: 0,
  fallbackTextHandled: 0,
  processingErrors: 0,
  unknownIntentHandled: 0,
  handoffEscalations: 0,
  complaintSignalsDetected: 0,
  complaintHandoffs: 0,
  complaintToHandoffLatencyMsTotal: 0,
  complaintToHandoffLatencyMsLast: 0,
  complaintToHandoffLatencyCount: 0,
  daily: {
    dayKey: getUtcDayKey(),
    inboundMessages: 0,
    aiHandled: 0,
    deterministicHandled: 0,
    ctaHandled: 0,
    adminDigestHandled: 0,
    adminDigestErrors: 0,
    nonTextHandled: 0,
    fallbackTextHandled: 0,
    processingErrors: 0,
    unknownIntentHandled: 0,
    handoffEscalations: 0,
    complaintSignalsDetected: 0,
    complaintHandoffs: 0,
    complaintToHandoffLatencyMsTotal: 0,
    complaintToHandoffLatencyMsLast: 0,
    complaintToHandoffLatencyCount: 0
  }
};
const buildInfo = {
  commit: process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? null,
  branch: process.env.RAILWAY_GIT_BRANCH ?? process.env.VERCEL_GIT_COMMIT_REF ?? null,
  startedAt: runtimeStats.startedAt
};
let inflightRequests = 0;
let isShuttingDown = false;

app.use("*", async (c, next) => {
  if (isShuttingDown) {
    return c.json(
      {
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "Service is shutting down"
        }
      },
      503
    );
  }
  inflightRequests += 1;
  try {
    await next();
  } finally {
    inflightRequests = Math.max(0, inflightRequests - 1);
  }
});

function getUtcDayKey() {
  return new Date().toISOString().slice(0, 10);
}

function bumpRuntimeCounter(key: RuntimeCounterKey) {
  runtimeStats[key] += 1;
  const dayKey = getUtcDayKey();
  if (runtimeStats.daily.dayKey !== dayKey) {
    runtimeStats.daily = {
      dayKey,
      inboundMessages: 0,
      aiHandled: 0,
      deterministicHandled: 0,
      ctaHandled: 0,
      adminDigestHandled: 0,
      adminDigestErrors: 0,
      nonTextHandled: 0,
      fallbackTextHandled: 0,
      processingErrors: 0,
      unknownIntentHandled: 0,
      handoffEscalations: 0,
      complaintSignalsDetected: 0,
      complaintHandoffs: 0,
      complaintToHandoffLatencyMsTotal: 0,
      complaintToHandoffLatencyMsLast: 0,
      complaintToHandoffLatencyCount: 0
    };
  }
  runtimeStats.daily[key] += 1;
}

function recordComplaintToHandoffLatency(latencyMs: number) {
  const safeLatency = Math.max(0, Math.round(latencyMs));
  runtimeStats.complaintToHandoffLatencyMsTotal += safeLatency;
  runtimeStats.complaintToHandoffLatencyMsLast = safeLatency;
  runtimeStats.complaintToHandoffLatencyCount += 1;
  const dayKey = getUtcDayKey();
  if (runtimeStats.daily.dayKey !== dayKey) {
    runtimeStats.daily = {
      dayKey,
      inboundMessages: 0,
      aiHandled: 0,
      deterministicHandled: 0,
      ctaHandled: 0,
      adminDigestHandled: 0,
      adminDigestErrors: 0,
      nonTextHandled: 0,
      fallbackTextHandled: 0,
      processingErrors: 0,
      unknownIntentHandled: 0,
      handoffEscalations: 0,
      complaintSignalsDetected: 0,
      complaintHandoffs: 0,
      complaintToHandoffLatencyMsTotal: 0,
      complaintToHandoffLatencyMsLast: 0,
      complaintToHandoffLatencyCount: 0
    };
  }
  runtimeStats.daily.complaintToHandoffLatencyMsTotal += safeLatency;
  runtimeStats.daily.complaintToHandoffLatencyMsLast = safeLatency;
  runtimeStats.daily.complaintToHandoffLatencyCount += 1;
}

type TelegramUpdate = {
  update_id?: number;
  message?: {
    text?: string;
    chat?: { id?: number };
    from?: { language_code?: string };
  };
};

type WhatsAppInbound = {
  messageId: string;
  from: string;
  phoneNumberId?: string;
  messageType: string;
  text?: string;
  replyId?: string;
  locale: SupportedLocale;
};

type WhatsAppChoice = {
  id: string;
  title: string;
  description?: string;
};

type AdminDigestHorizon = "today" | "tomorrow" | "next";

type OpsAlertSeverity = "warning" | "critical";

const routingCache = new Map<string, { context: BotRoutingContext; expiresAtMs: number }>();
const routingCacheTtlMs = 5 * 60 * 1000;
const waAccessTokenByPhone = parseWhatsAppAccessTokenMap(waAccessTokenByPhoneRaw);
const waTokenHealthRequired = process.env.WA_TOKEN_HEALTH_REQUIRED === "true";
const waTokenHealthCacheTtlMs = Math.max(
  10_000,
  Number.parseInt(process.env.WA_TOKEN_HEALTH_CACHE_TTL_MS ?? "300000", 10) || 300000
);
let waTokenHealthCache: {
  checkedAtMs: number;
  status: "ok" | "error" | "disabled";
  details: Array<{ phoneNumberId: string; status: "ok" | "error"; httpStatus?: number }>;
} | null = null;

function parseWhatsAppAccessTokenMap(raw: string) {
  if (!raw.trim()) {
    return new Map<string, string>();
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return new Map<string, string>();
    }
    const out = new Map<string, string>();
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const phoneNumberId = key.trim();
      const token = typeof value === "string" ? value.trim() : "";
      if (phoneNumberId && token) {
        out.set(phoneNumberId, token);
      }
    }
    return out;
  } catch (error) {
    console.warn("[bot] WA_ACCESS_TOKEN_BY_PHONE_JSON parse failed", {
      error: toLogError(error)
    });
    return new Map<string, string>();
  }
}

function parseNonNegativeNumber(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseFloat(value.trim());
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return fallback;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

async function emitOpsAlert(input: {
  event: string;
  severity: OpsAlertSeverity;
  context: Record<string, unknown>;
}) {
  const payload = {
    source: "bot",
    event: input.event,
    severity: input.severity,
    ts: new Date().toISOString(),
    context: sanitizeAlertContext(input.context)
  };
  const logger = input.severity === "critical" ? console.error : console.warn;
  logger("[bot][alert]", payload);

  if (!opsAlertWebhookUrl) {
    return;
  }

  try {
    const headers: Record<string, string> = {
      "content-type": "application/json"
    };
    if (opsAlertWebhookToken) {
      headers.authorization = `Bearer ${opsAlertWebhookToken}`;
    }
    await fetch(opsAlertWebhookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });
  } catch (error) {
    console.error("[bot][alert] delivery failed", {
      event: input.event,
      error: toLogError(error)
    });
  }
}

async function sendTelegramMessage(input: { chatId: number; text: string }) {
  if (!telegramBotToken) {
    console.warn("[bot] TG_BOT_TOKEN is not configured; message send skipped");
    return { sent: false, reason: "missing_bot_token" as const };
  }

  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: input.chatId,
        text: input.text
      })
    });
  } catch (error) {
    console.error("[bot] telegram send network error", {
      error: toLogError(error)
    });
    await emitOpsAlert({
      event: "telegram_send_network_error",
      severity: "warning",
      context: {
        error: toLogError(error)
      }
    });
    await captureException({
      service: "bot",
      error,
      context: { operation: "telegram_send_message" }
    });
    return { sent: false, reason: "telegram_network_error" as const };
  }

  if (!response.ok) {
    const payload = await response.text();
    const sanitizedPayload = redactLogString(payload).slice(0, 500);
    console.error("[bot] telegram send failed", {
      status: response.status,
      payload: sanitizedPayload
    });
    await emitOpsAlert({
      event: "telegram_send_failed",
      severity: "warning",
      context: {
        status: response.status,
        payload: sanitizedPayload
      }
    });
    await captureException({
      service: "bot",
      error: new Error(`telegram_send_failed:${response.status}`),
      context: { payload: sanitizedPayload }
    });
    return { sent: false, reason: "telegram_api_failed" as const };
  }

  return { sent: true as const };
}

function resolveOutgoingWhatsAppPhoneNumberId(routeContext?: BotRoutingContext | null) {
  const routed = routeContext?.externalEndpointId?.trim();
  if (routed) {
    return routed;
  }
  return waPhoneNumberId;
}

function resolveOutgoingWhatsAppAccessToken(phoneNumberId: string) {
  const byPhone = waAccessTokenByPhone.get(phoneNumberId);
  if (byPhone) {
    return byPhone;
  }
  return waAccessToken;
}

async function sendWhatsAppPayload(input: {
  to: string;
  payload: Record<string, unknown>;
  routeContext?: BotRoutingContext | null;
  trackOutboundState?: boolean;
}) {
  const trackOutboundState = input.trackOutboundState !== false;
  const kind = String(input.payload.type ?? "unknown");
  const routeContext = input.routeContext ?? getLegacyRouteContext();
  const maxAttempts = waOutboundRetryAttempts + 1;
  let lastFailureReason:
    | "missing_whatsapp_config"
    | "whatsapp_network_error"
    | "whatsapp_api_failed"
    | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await sendWhatsAppPayloadOnce({
      to: input.to,
      payload: input.payload,
      routeContext
    });
    if (result.sent) {
      if (trackOutboundState) {
        await updateOutboundReplayState(input.to, routeContext, {
          failed: false,
          payload: input.payload,
          updatedAt: new Date().toISOString(),
          failureCount: 0,
          lastFailureReason: null
        });
      }
      return { sent: true as const };
    }
    lastFailureReason = result.reason;
    if (attempt < maxAttempts) {
      await sleepMs(waOutboundRetryBaseDelayMs * Math.pow(2, attempt - 1));
    }
  }

  if (trackOutboundState) {
    await updateOutboundReplayState(input.to, routeContext, {
      failed: true,
      payload: input.payload,
      updatedAt: new Date().toISOString(),
      failureCount: 1,
      lastFailureReason: lastFailureReason ?? "whatsapp_network_error"
    });
  }
  await emitOpsAlert({
    event: "whatsapp_send_failed_all_retries",
    severity: "critical",
    context: {
      to: maskPhone(input.to),
      type: kind,
      attempts: maxAttempts,
      reason: lastFailureReason ?? "unknown"
    }
  });
  return {
    sent: false as const,
    reason: lastFailureReason ?? "whatsapp_network_error"
  };
}

async function sendWhatsAppPayloadOnce(input: {
  to: string;
  payload: Record<string, unknown>;
  routeContext?: BotRoutingContext | null;
}) {
  const outgoingPhoneNumberId = resolveOutgoingWhatsAppPhoneNumberId(input.routeContext);
  const outgoingAccessToken = outgoingPhoneNumberId
    ? resolveOutgoingWhatsAppAccessToken(outgoingPhoneNumberId)
    : "";
  if (!outgoingPhoneNumberId || !outgoingAccessToken) {
    console.warn("[bot] WhatsApp API credentials are not configured; message send skipped");
    return { sent: false, reason: "missing_whatsapp_config" as const };
  }

  const kind = String(input.payload.type ?? "unknown");
  console.info("[bot] whatsapp outgoing request", {
    to: maskPhone(input.to),
    type: kind
  });

  let response: Response;
  try {
    response = await fetch(`https://graph.facebook.com/v21.0/${outgoingPhoneNumberId}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${outgoingAccessToken}`
      },
      body: JSON.stringify(input.payload)
    });
  } catch (error) {
    console.error("[bot] whatsapp send network error", {
      to: maskPhone(input.to),
      type: kind,
      error: toLogError(error)
    });
    await emitOpsAlert({
      event: "whatsapp_send_network_error",
      severity: "warning",
      context: {
        to: maskPhone(input.to),
        type: kind,
        error: toLogError(error)
      }
    });
    await captureException({
      service: "bot",
      error,
      context: {
        operation: "whatsapp_send_message",
        to: maskPhone(input.to),
        type: kind
      }
    });
    return { sent: false, reason: "whatsapp_network_error" as const };
  }

  if (!response.ok) {
    const payload = await response.text();
    const sanitizedPayload = redactLogString(payload).slice(0, 500);
    console.error("[bot] whatsapp send failed", {
      status: response.status,
      payload: sanitizedPayload
    });
    await emitOpsAlert({
      event: "whatsapp_send_failed",
      severity: "warning",
      context: {
        status: response.status,
        payload: sanitizedPayload,
        to: maskPhone(input.to),
        type: kind
      }
    });
    await captureException({
      service: "bot",
      error: new Error(`whatsapp_send_failed:${response.status}`),
      context: { payload: sanitizedPayload }
    });
    return { sent: false, reason: "whatsapp_api_failed" as const };
  }

  console.info("[bot] whatsapp outgoing delivered", {
    to: maskPhone(input.to),
    type: kind,
    status: response.status
  });

  if (input.routeContext?.accountId && input.routeContext?.salonId) {
    await recordEnterpriseUsageEvent({
      routeContext: input.routeContext,
      metric: "messages_outbound",
      context: {
        source: "whatsapp_send",
        messageType: kind
      }
    });
  }

  return { sent: true as const };
}

async function sendWhatsAppMessage(input: {
  to: string;
  text: string;
  routeContext?: BotRoutingContext | null;
}) {
  return sendWhatsAppPayload({
    to: input.to,
    routeContext: input.routeContext,
    payload: {
      messaging_product: "whatsapp",
      to: input.to,
      type: "text",
      text: { body: input.text }
    }
  });
}

async function sendWhatsAppButtons(input: {
  to: string;
  bodyText: string;
  choices: WhatsAppChoice[];
  routeContext?: BotRoutingContext | null;
}) {
  const buttons = input.choices.slice(0, 3).map((choice) => ({
    type: "reply",
    reply: {
      id: choice.id,
      title: choice.title.slice(0, 20)
    }
  }));
  return sendWhatsAppPayload({
    to: input.to,
    routeContext: input.routeContext,
    payload: {
      messaging_product: "whatsapp",
      to: input.to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: input.bodyText.slice(0, 1024) },
        action: { buttons }
      }
    }
  });
}

async function sendWhatsAppList(input: {
  to: string;
  bodyText: string;
  buttonText: string;
  choices: WhatsAppChoice[];
  routeContext?: BotRoutingContext | null;
}) {
  const rows = input.choices.slice(0, 10).map((choice) => ({
    id: choice.id,
    title: choice.title.slice(0, 24),
    description: choice.description?.slice(0, 72)
  }));
  return sendWhatsAppPayload({
    to: input.to,
    routeContext: input.routeContext,
    payload: {
      messaging_product: "whatsapp",
      to: input.to,
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: input.bodyText.slice(0, 1024) },
        action: {
          button: input.buttonText.slice(0, 20),
          sections: [
            {
              title: "Options",
              rows
            }
          ]
        }
      }
    }
  });
}

async function markWhatsAppMessageAsRead(input: {
  incomingPhoneNumberId?: string;
  messageId: string;
}) {
  const phoneNumberId = input.incomingPhoneNumberId?.trim();
  if (!phoneNumberId || !input.messageId) {
    return;
  }
  const token = resolveOutgoingWhatsAppAccessToken(phoneNumberId);
  if (!token) {
    return;
  }
  try {
    await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: input.messageId
      })
    });
  } catch {
    // Best-effort signal for the client UI; failures must not interrupt the message pipeline.
  }
}

function resolveLocaleFromTelegram(update: TelegramUpdate): SupportedLocale {
  const languageCode = update.message?.from?.language_code?.toLowerCase();
  return resolveLocale({
    requested: languageCode?.startsWith("it") ? "it" : languageCode?.startsWith("en") ? "en" : undefined,
    tenantDefault: "it",
    fallback: "en"
  });
}

function resolveLocaleFromWhatsApp(payloadLocale?: string): SupportedLocale {
  const normalized = payloadLocale?.toLowerCase();
  return resolveLocale({
    requested:
      normalized?.startsWith("it") ? "it" : normalized?.startsWith("en") ? "en" : undefined,
    tenantDefault: "it",
    fallback: "en"
  });
}

function assertWhatsAppSignature(signatureHeader: string | undefined, rawBody: string) {
  if (!waWebhookSecret) {
    return;
  }
  if (!signatureHeader?.startsWith("sha256=")) {
    throw new Error("missing_or_invalid_whatsapp_signature");
  }

  const incomingHex = signatureHeader.slice("sha256=".length).trim();
  const expectedHex = createHmac("sha256", waWebhookSecret).update(rawBody).digest("hex");

  const incoming = Buffer.from(incomingHex, "hex");
  const expected = Buffer.from(expectedHex, "hex");
  if (incoming.length !== expected.length || !timingSafeEqual(incoming, expected)) {
    throw new Error("invalid_whatsapp_signature");
  }
}

function normalizeWhatsAppPhone(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (trimmed.startsWith("+")) {
    return trimmed;
  }
  if (/^\d+$/.test(trimmed)) {
    return `+${trimmed}`;
  }
  return trimmed;
}

function isStructuredControlMessage(value: string) {
  const normalized = value.trim().toLowerCase();
  const cancelPhrase = /\b(annulla(?:re)?|disdici|elimina)\b(?:\s+\w+){0,2}\s+\b(prenotazione|prenotazioni|appuntamento|appuntamenti)\b/.test(
    normalized
  );
  return (
    normalized === "/start" ||
    normalized === "start" ||
    normalized === "menu" ||
    normalized === "back" ||
    normalized === "restart" ||
    normalized === "/cancel" ||
    normalized === "cancel" ||
    normalized === "annulla" ||
    cancelPhrase
  );
}

function mapConfirmEmojiReplyId(
  session: WhatsAppConversationSession | null,
  text: string | undefined
): string | undefined {
  if (!session || session.state !== "confirm" || !text) {
    return undefined;
  }
  const normalized = text.trim();
  if (!normalized) {
    return undefined;
  }
  const confirmEmoji = new Set(["👍", "✅", "👌", "🙏", "💯", "✔️", "☑️"]);
  const cancelEmoji = new Set(["👎", "❌", "🚫", "🙅"]);
  if (confirmEmoji.has(normalized)) {
    return "confirm:yes";
  }
  if (cancelEmoji.has(normalized)) {
    return "confirm:cancel";
  }
  return undefined;
}

function getLegacyRouteContext() {
  return resolveLegacyBotRoute({
    tenantSlug: botTenantSlug,
    tenantId: botTenantId
  });
}

function getTenantQuotaKey(routeContext: BotRoutingContext | null) {
  if (!routeContext) {
    return "default";
  }
  return routeContext.tenantSlug || routeContext.tenantId || routeContext.salonId || "default";
}

function isAiCanaryEnabledForTenant(routeContext: BotRoutingContext | null = getLegacyRouteContext()) {
  if (openAiCanaryTenants.length === 0) {
    return true;
  }
  const tenantKeys = [
    routeContext?.tenantSlug,
    routeContext?.tenantId,
    routeContext?.salonId,
    routeContext?.accountId
  ].filter((value): value is string => Boolean(value));
  return tenantKeys.some((key) => openAiCanaryTenants.includes(key));
}

async function resolveWhatsAppRouteContext(item: WhatsAppInbound) {
  const externalEndpointId = item.phoneNumberId?.trim();
  if (!externalEndpointId) {
    return getLegacyRouteContext();
  }

  const now = Date.now();
  const cached = routingCache.get(externalEndpointId);
  if (cached && cached.expiresAtMs > now) {
    return cached.context;
  }

  const resolved = await resolveChannelRouteFromApi({
    apiUrl,
    internalApiSecret,
    provider: "whatsapp",
    externalEndpointId
  });
  if (resolved.ok) {
    routingCache.set(externalEndpointId, {
      context: resolved.context,
      expiresAtMs: now + routingCacheTtlMs
    });
    return resolved.context;
  }

  if (waEnterpriseRoutingRequired) {
    return null;
  }

  if (resolved.reason !== "not_found") {
    console.warn("[bot] channel routing resolver fallback", {
      reason: resolved.reason,
      externalEndpointId
    });
  }
  return getLegacyRouteContext();
}


async function consumeAiDailyQuota(input: { tenantKey: string; dayKey: string; limit: number }) {
  if (!redis) {
    return { allowed: true, used: 0 };
  }
  if (redis.status === "wait") {
    await redis.connect();
  }
  const quotaKey = `bot:ai:quota:${input.tenantKey}:${input.dayKey}`;
  const used = await redis.incr(quotaKey);
  if (used === 1) {
    await redis.expire(quotaKey, 60 * 60 * 30);
  }
  const warningThreshold = Math.max(1, Math.floor(input.limit * 0.8));
  if (used === warningThreshold) {
    console.warn("[bot] ai daily quota reached warning threshold", {
      tenantKey: input.tenantKey,
      dayKey: input.dayKey,
      used,
      limit: input.limit,
      threshold: warningThreshold
    });
    await emitOpsAlert({
      event: "ai_daily_quota_warning",
      severity: "warning",
      context: {
        tenantKey: input.tenantKey,
        dayKey: input.dayKey,
        used,
        limit: input.limit,
        threshold: warningThreshold
      }
    });
  }
  if (used === input.limit) {
    console.warn("[bot] ai daily quota reached hard limit", {
      tenantKey: input.tenantKey,
      dayKey: input.dayKey,
      used,
      limit: input.limit
    });
    await emitOpsAlert({
      event: "ai_daily_quota_exceeded",
      severity: "critical",
      context: {
        tenantKey: input.tenantKey,
        dayKey: input.dayKey,
        used,
        limit: input.limit
      }
    });
  }
  return {
    allowed: used <= input.limit,
    used
  };
}

async function checkInboundRateLimit(input: {
  phone: string;
  windowSeconds: number;
  maxMessages: number;
  routeContext?: BotRoutingContext | null;
}) {
  if (!redis) {
    return { allowed: true, used: 0 };
  }
  if (redis.status === "wait") {
    await redis.connect();
  }
  const scope = input.routeContext ? getRoutingScopeSegment(input.routeContext) : "legacy";
  const key = `bot:rl:wa:${scope}:${input.phone}`;
  const used = await redis.incr(key);
  if (used === 1) {
    await redis.expire(key, input.windowSeconds);
  }
  return {
    allowed: used <= input.maxMessages,
    used
  };
}

async function checkTenantInboundRateLimit(input: {
  tenantKey: string;
  windowSeconds: number;
  maxMessages: number;
}) {
  if (!redis) {
    return { allowed: true, used: 0 };
  }
  if (redis.status === "wait") {
    await redis.connect();
  }
  const key = `bot:rl:tenant:${input.tenantKey}`;
  const used = await redis.incr(key);
  if (used === 1) {
    await redis.expire(key, input.windowSeconds);
  }
  return {
    allowed: used <= input.maxMessages,
    used
  };
}

async function recordTenantUnknownIntentAndAlert(input: {
  tenantKey: string;
  windowSeconds: number;
  threshold: number;
}) {
  if (!redis) {
    return { used: 0, alerted: false };
  }
  if (redis.status === "wait") {
    await redis.connect();
  }

  const baseKey = `bot:unknown:tenant:${input.tenantKey}`;
  const counterKey = `${baseKey}:count`;
  const alertOnceKey = `${baseKey}:alerted`;
  const used = await redis.incr(counterKey);
  if (used === 1) {
    await redis.expire(counterKey, input.windowSeconds);
  }

  let alerted = false;
  if (used >= input.threshold) {
    const alertSet = await redis.set(alertOnceKey, "1", "EX", input.windowSeconds, "NX");
    alerted = alertSet === "OK";
  }
  return { used, alerted };
}

async function sleepMs(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForInflightRequests(timeoutMs: number) {
  const startedAt = Date.now();
  while (inflightRequests > 0 && Date.now() - startedAt < timeoutMs) {
    await sleepMs(200);
  }
}

async function fetchWithApiRetry(
  url: string,
  init: RequestInit,
  input: { retries?: number; baseDelayMs?: number } = {}
) {
  const retries = Math.max(0, input.retries ?? 2);
  const baseDelayMs = Math.max(50, input.baseDelayMs ?? 250);
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (response.status >= 500 || response.status === 429) {
        lastError = new Error(`api_retryable_status:${response.status}`);
      } else {
        return response;
      }
    } catch (error) {
      lastError = error;
    }

    if (attempt < retries) {
      await sleepMs(baseDelayMs * (attempt + 1));
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error("api_retry_failed");
}

async function recordEnterpriseUsageEvent(input: {
  routeContext: BotRoutingContext | null;
  metric: "messages_inbound" | "messages_outbound" | "ai_calls";
  quantity?: number;
  dedupeKey?: string;
  context?: Record<string, unknown>;
}) {
  if (!apiUrl || !internalApiSecret || !input.routeContext) {
    return;
  }
  try {
    await fetchWithApiRetry(`${apiUrl}/api/v1/enterprise-v2/usage-events`, {
      method: "POST",
      headers: buildInternalHeaders(input.routeContext),
      body: JSON.stringify({
        accountId: input.routeContext.accountId,
        salonId: input.routeContext.salonId,
        metric: input.metric,
        quantity: input.quantity ?? 1,
        dedupeKey: input.dedupeKey,
        context: input.context
      })
    });
  } catch (error) {
    console.warn("[bot] usage event emit failed", {
      metric: input.metric,
      accountId: input.routeContext.accountId,
      salonId: input.routeContext.salonId,
      error: toLogError(error)
    });
  }
}

function extractWhatsAppInbound(payload: unknown): WhatsAppInbound[] {
  const root = typeof payload === "object" && payload ? (payload as Record<string, unknown>) : {};
  const entries = Array.isArray(root.entry) ? root.entry : [];
  const items: WhatsAppInbound[] = [];

  for (const entry of entries) {
    const entryObj = typeof entry === "object" && entry ? (entry as Record<string, unknown>) : {};
    const changes = Array.isArray(entryObj.changes) ? entryObj.changes : [];
    for (const change of changes) {
      const changeObj =
        typeof change === "object" && change ? (change as Record<string, unknown>) : {};
      const value =
        typeof changeObj.value === "object" && changeObj.value
          ? (changeObj.value as Record<string, unknown>)
          : {};
      const metadata =
        typeof value.metadata === "object" && value.metadata
          ? (value.metadata as Record<string, unknown>)
          : {};
      const phoneNumberId =
        typeof metadata.phone_number_id === "string" ? metadata.phone_number_id : undefined;
      const contacts = Array.isArray(value.contacts) ? value.contacts : [];
      const messages = Array.isArray(value.messages) ? value.messages : [];

      const locale =
        contacts.length > 0 &&
        typeof contacts[0] === "object" &&
        contacts[0] &&
        typeof (contacts[0] as Record<string, unknown>).profile === "object" &&
        (contacts[0] as Record<string, unknown>).profile
          ? String(
              ((contacts[0] as Record<string, unknown>).profile as Record<string, unknown>)
                .language_code ?? ""
            )
          : "";

      for (const rawMessage of messages) {
        const msg =
          typeof rawMessage === "object" && rawMessage
            ? (rawMessage as Record<string, unknown>)
            : {};
        const type = typeof msg.type === "string" ? msg.type : "";
        const textContainer =
          typeof msg.text === "object" && msg.text ? (msg.text as Record<string, unknown>) : {};
        const text = textContainer.body;
        const button =
          typeof msg.button === "object" && msg.button ? (msg.button as Record<string, unknown>) : {};
        const interactive =
          typeof msg.interactive === "object" && msg.interactive
            ? (msg.interactive as Record<string, unknown>)
            : {};
        const interactiveType = typeof interactive.type === "string" ? interactive.type : "";
        const buttonReply =
          typeof interactive.button_reply === "object" && interactive.button_reply
            ? (interactive.button_reply as Record<string, unknown>)
            : {};
        const listReply =
          typeof interactive.list_reply === "object" && interactive.list_reply
            ? (interactive.list_reply as Record<string, unknown>)
            : {};
        const replyId =
          interactiveType === "button_reply"
            ? buttonReply.id
            : interactiveType === "list_reply"
              ? listReply.id
              : type === "button"
                ? button.payload
              : undefined;
        const from = msg.from;
        const messageId = msg.id;
        if (typeof from !== "string" || typeof messageId !== "string") {
          continue;
        }
        if (type === "text" && typeof text !== "string") {
          continue;
        }
        if ((type === "interactive" || type === "button") && typeof replyId !== "string") {
          continue;
        }
        items.push({
          messageId,
          from: normalizeWhatsAppPhone(from),
          phoneNumberId,
          messageType: type || "unknown",
          text: typeof text === "string" ? text : undefined,
          replyId: typeof replyId === "string" ? replyId : undefined,
          locale: resolveLocaleFromWhatsApp(locale)
        });
      }
    }
  }

  return items;
}

async function fetchSlotsFromApi(input: {
  serviceId: string;
  date: string;
  masterId?: string;
  locale: SupportedLocale;
  routeContext?: BotRoutingContext | null;
}) {
  const routeContext = input.routeContext ?? getLegacyRouteContext();
  if (!apiUrl || !internalApiSecret || (!routeContext?.tenantSlug && !routeContext?.tenantId)) {
    throw new Error("bot_api_config_missing");
  }

  const params = new URLSearchParams({
    serviceId: input.serviceId,
    date: input.date
  });
  if (input.masterId) {
    params.set("masterId", input.masterId);
  }

  const headers = buildInternalHeaders(routeContext, { includeContentType: false });

  const response = await fetchWithApiRetry(`${apiUrl}/api/v1/public/slots?${params.toString()}`, {
    method: "GET",
    headers
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? "slots_request_failed");
  }

  if (!Array.isArray(payload?.data?.items)) {
    return [] as Array<{ startAt: string; displayTime: string }>;
  }

  const rawItems = payload.data.items as Array<Record<string, unknown>>;
  const validItems: Array<{ startAt: string; displayTime: string }> = [];
  for (const item of rawItems) {
    const startAt = asNonEmptyString(item.startAt);
    const displayTime = asNonEmptyString(item.displayTime);
    if (!startAt || !displayTime) {
      continue;
    }
    validItems.push({ startAt, displayTime });
  }
  if (validItems.length !== rawItems.length) {
    console.warn("[bot] invalid slots filtered from api response", {
      total: rawItems.length,
      valid: validItems.length
    });
  }
  return validItems;
}

function buildInternalHeaders(
  routeContext: BotRoutingContext | null = getLegacyRouteContext(),
  options: { includeContentType?: boolean } = {}
) {
  const headers: Record<string, string> = {
    "x-internal-secret": internalApiSecret,
    "x-csrf-token": "bot-internal"
  };
  if (options.includeContentType !== false) {
    headers["content-type"] = "application/json";
  }
  if (routeContext?.tenantSlug) {
    headers["x-internal-tenant-slug"] = routeContext.tenantSlug;
  }
  if (routeContext?.tenantId) {
    headers["x-internal-tenant-id"] = routeContext.tenantId;
  }
  if (routeContext?.accountId) {
    headers["x-internal-account-id"] = routeContext.accountId;
  }
  if (routeContext?.salonId) {
    headers["x-internal-salon-id"] = routeContext.salonId;
  }
  return headers;
}

async function touchWhatsAppWindowFromInbound(input: {
  routeContext: BotRoutingContext | null;
  senderPhoneNumberId?: string;
  recipientE164: string;
  locale: SupportedLocale;
}) {
  if (!apiUrl || !internalApiSecret || !input.routeContext) {
    return;
  }
  if (!input.senderPhoneNumberId?.trim()) {
    return;
  }
  try {
    await fetchWithApiRetry(`${apiUrl}/api/v1/public/whatsapp/window-touch`, {
      method: "POST",
      headers: buildInternalHeaders(input.routeContext),
      body: JSON.stringify({
        senderPhoneNumberId: input.senderPhoneNumberId.trim(),
        recipientE164: input.recipientE164,
        locale: input.locale
      })
    });
  } catch (error) {
    console.warn("[bot] whatsapp window touch failed", {
      recipient: maskPhone(input.recipientE164),
      senderPhoneNumberId: input.senderPhoneNumberId?.trim() ?? null,
      error: toLogError(error)
    });
  }
}

function getSessionKey(phone: string, routeContext: BotRoutingContext | null = getLegacyRouteContext()) {
  if (!routeContext) {
    return `wa:session:unknown:${phone}`;
  }
  return buildScopedSessionKey({
    context: routeContext,
    provider: "whatsapp",
    identity: phone
  });
}

function getOutboundReplayKey(
  phone: string,
  routeContext: BotRoutingContext | null = getLegacyRouteContext()
) {
  if (!routeContext) {
    return `wa:outbound:unknown:${phone}`;
  }
  return buildScopedSessionKey({
    context: routeContext,
    provider: "whatsapp_outbound",
    identity: phone
  });
}

function getInboundDedupKey(messageId: string) {
  return `wa:inbound:${messageId}`;
}

function getAdminRejectPendingKey(
  phone: string,
  routeContext: BotRoutingContext | null = getLegacyRouteContext()
) {
  if (!routeContext) {
    return `wa:admin-reject:unknown:${phone}`;
  }
  return `wa:admin-reject:${getRoutingScopeSegment(routeContext)}:${phone}`;
}

function getSessionProcessingLockKey(
  phone: string,
  routeContext: BotRoutingContext | null = getLegacyRouteContext()
) {
  return `${getSessionKey(phone, routeContext)}:lock`;
}

type OutboundReplayState = {
  failed: boolean;
  payload?: Record<string, unknown>;
  updatedAt: string;
  failureCount: number;
  lastFailureReason?: string | null;
};

type AdminRejectPendingState = {
  bookingId: string;
  adminPhoneE164: string;
  locale: SupportedLocale;
  expiresAtUnix: number;
};

async function loadOutboundReplayState(
  phone: string,
  routeContext: BotRoutingContext | null = getLegacyRouteContext()
): Promise<OutboundReplayState | null> {
  if (!redis) {
    return null;
  }
  if (redis.status === "wait") {
    await redis.connect();
  }
  const raw = await redis.get(getOutboundReplayKey(phone, routeContext));
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<OutboundReplayState>;
    return {
      failed: parsed.failed === true,
      payload:
        typeof parsed.payload === "object" && parsed.payload
          ? (parsed.payload as Record<string, unknown>)
          : undefined,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
      failureCount:
        typeof parsed.failureCount === "number" && Number.isFinite(parsed.failureCount)
          ? Math.max(0, Math.trunc(parsed.failureCount))
          : 0,
      lastFailureReason:
        typeof parsed.lastFailureReason === "string" ? parsed.lastFailureReason : null
    };
  } catch {
    return null;
  }
}

async function updateOutboundReplayState(
  phone: string,
  routeContext: BotRoutingContext | null,
  update: OutboundReplayState
) {
  if (!redis) {
    return;
  }
  if (redis.status === "wait") {
    await redis.connect();
  }
  let failureCount = update.failureCount;
  if (update.failed) {
    const existing = await loadOutboundReplayState(phone, routeContext);
    failureCount = Math.max(1, (existing?.failureCount ?? 0) + 1);
  }
  const next: OutboundReplayState = {
    ...update,
    failureCount
  };
  await redis.set(
    getOutboundReplayKey(phone, routeContext),
    JSON.stringify(next),
    "EX",
    waOutboundStateTtlSeconds
  );
}

async function replayPendingOutboundIfNeeded(
  phone: string,
  routeContext: BotRoutingContext | null
): Promise<{ replayed: boolean; delivered: boolean }> {
  const state = await loadOutboundReplayState(phone, routeContext);
  if (!state?.failed || !state.payload) {
    return { replayed: false, delivered: false };
  }
  const result = await sendWhatsAppPayload({
    to: phone,
    payload: state.payload,
    routeContext,
    trackOutboundState: false
  });
  await updateOutboundReplayState(phone, routeContext, {
    failed: !result.sent,
    payload: state.payload,
    updatedAt: new Date().toISOString(),
    failureCount: state.failureCount,
    lastFailureReason: result.sent ? null : result.reason
  });
  return {
    replayed: true,
    delivered: result.sent
  };
}

async function loadWhatsAppSession(
  phone: string,
  routeContext: BotRoutingContext | null = getLegacyRouteContext()
): Promise<WhatsAppConversationSession | null> {
  if (!redis) {
    return null;
  }
  if (redis.status === "wait") {
    await redis.connect();
  }
  const raw = await redis.get(getSessionKey(phone, routeContext));
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<WhatsAppConversationSession>;
    const fallbackLocale: SupportedLocale =
      parsed.locale === "it" || parsed.locale === "en" ? parsed.locale : "it";
    return migrateWhatsAppSession(parsed as WhatsAppConversationSession, fallbackLocale);
  } catch {
    return null;
  }
}

async function saveWhatsAppSession(
  phone: string,
  session: WhatsAppConversationSession,
  routeContext: BotRoutingContext | null = getLegacyRouteContext()
) {
  if (!redis) {
    return;
  }
  if (redis.status === "wait") {
    await redis.connect();
  }
  const safeSession = migrateWhatsAppSession(session, session.locale);
  await redis.set(
    getSessionKey(phone, routeContext),
    JSON.stringify(safeSession),
    "EX",
    sessionRedisTtlSeconds
  );
}

async function clearWhatsAppSession(
  phone: string,
  routeContext: BotRoutingContext | null = getLegacyRouteContext()
) {
  if (!redis) {
    return;
  }
  if (redis.status === "wait") {
    await redis.connect();
  }
  await redis.del(getSessionKey(phone, routeContext));
}

async function dedupInboundMessage(messageId: string): Promise<boolean> {
  if (!redis) {
    return true;
  }
  if (redis.status === "wait") {
    await redis.connect();
  }
  const created = await redis.set(getInboundDedupKey(messageId), "1", "EX", 24 * 60 * 60, "NX");
  return created === "OK";
}

async function loadAdminRejectPending(
  phone: string,
  routeContext: BotRoutingContext | null = getLegacyRouteContext()
): Promise<AdminRejectPendingState | null> {
  if (!redis) {
    return null;
  }
  if (redis.status === "wait") {
    await redis.connect();
  }
  const raw = await redis.get(getAdminRejectPendingKey(phone, routeContext));
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<AdminRejectPendingState>;
    if (!parsed.bookingId || !parsed.adminPhoneE164) {
      return null;
    }
    return {
      bookingId: parsed.bookingId,
      adminPhoneE164: parsed.adminPhoneE164,
      locale: parsed.locale === "en" ? "en" : "it",
      expiresAtUnix:
        typeof parsed.expiresAtUnix === "number" && Number.isFinite(parsed.expiresAtUnix)
          ? Math.trunc(parsed.expiresAtUnix)
          : Math.floor(Date.now() / 1000)
    };
  } catch {
    return null;
  }
}

async function saveAdminRejectPending(
  phone: string,
  state: AdminRejectPendingState,
  routeContext: BotRoutingContext | null = getLegacyRouteContext()
) {
  if (!redis) {
    return;
  }
  if (redis.status === "wait") {
    await redis.connect();
  }
  await redis.set(
    getAdminRejectPendingKey(phone, routeContext),
    JSON.stringify(state),
    "EX",
    adminRejectReasonTtlSeconds
  );
}

async function clearAdminRejectPending(
  phone: string,
  routeContext: BotRoutingContext | null = getLegacyRouteContext()
) {
  if (!redis) {
    return;
  }
  if (redis.status === "wait") {
    await redis.connect();
  }
  await redis.del(getAdminRejectPendingKey(phone, routeContext));
}

async function acquireSessionProcessingLock(input: {
  phone: string;
  routeContext: BotRoutingContext | null;
  ttlMs?: number;
  attempts?: number;
  delayMs?: number;
}) {
  if (!redis) {
    return { acquired: true as const, token: "no-redis-lock" };
  }
  if (redis.status === "wait") {
    await redis.connect();
  }
  const lockKey = getSessionProcessingLockKey(input.phone, input.routeContext);
  const token = randomUUID();
  const ttlMs = Math.max(1000, input.ttlMs ?? 15000);
  const attempts = Math.max(1, input.attempts ?? 8);
  const delayMs = Math.max(25, input.delayMs ?? 80);
  for (let index = 0; index < attempts; index += 1) {
    const result = await redis.set(lockKey, token, "PX", ttlMs, "NX");
    if (result === "OK") {
      return { acquired: true as const, token };
    }
    if (index < attempts - 1) {
      await sleepMs(delayMs);
    }
  }
  return { acquired: false as const, token };
}

async function releaseSessionProcessingLock(input: {
  phone: string;
  routeContext: BotRoutingContext | null;
  token: string;
}) {
  if (!redis || input.token === "no-redis-lock") {
    return;
  }
  if (redis.status === "wait") {
    await redis.connect();
  }
  const lockKey = getSessionProcessingLockKey(input.phone, input.routeContext);
  await redis.eval(
    `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`,
    1,
    lockKey,
    input.token
  );
}

async function fetchServicesForConversation(
  locale: SupportedLocale,
  routeContext: BotRoutingContext | null = getLegacyRouteContext()
) {
  if (!apiUrl || !internalApiSecret || (!routeContext?.tenantSlug && !routeContext?.tenantId)) {
    return [] as Array<{ id: string; displayName: string; durationMinutes?: number }>;
  }
  const response = await fetchWithApiRetry(`${apiUrl}/api/v1/public/services?locale=${locale}`, {
    method: "GET",
    headers: buildInternalHeaders(routeContext, { includeContentType: false })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(payload?.data?.items)) {
    return [] as Array<{ id: string; displayName: string; durationMinutes?: number }>;
  }
  const rawItems = payload.data.items as Array<Record<string, unknown>>;
  const validItems: Array<{ id: string; displayName: string; durationMinutes?: number }> = [];
  for (const item of rawItems) {
    const id = asNonEmptyString(item.id);
    const displayName = asNonEmptyString(item.displayName);
    if (!id || !displayName) {
      continue;
    }
    validItems.push({
      id,
      displayName,
      durationMinutes:
        typeof item.durationMinutes === "number" ? Number(item.durationMinutes) : undefined
    });
  }
  if (validItems.length !== rawItems.length) {
    console.warn("[bot] invalid services filtered from api response", {
      total: rawItems.length,
      valid: validItems.length
    });
  }
  return validItems;
}

async function fetchMastersForConversation(
  locale: SupportedLocale,
  serviceId?: string,
  routeContext: BotRoutingContext | null = getLegacyRouteContext()
) {
  if (!apiUrl || !internalApiSecret || (!routeContext?.tenantSlug && !routeContext?.tenantId)) {
    return [] as Array<{ id: string; displayName: string }>;
  }
  const params = new URLSearchParams({ locale });
  if (serviceId) {
    params.set("serviceId", serviceId);
  }
  const response = await fetchWithApiRetry(`${apiUrl}/api/v1/public/masters?${params.toString()}`, {
    method: "GET",
    headers: buildInternalHeaders(routeContext, { includeContentType: false })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(payload?.data?.items)) {
    return [] as Array<{ id: string; displayName: string }>;
  }
  const rawItems = payload.data.items as Array<Record<string, unknown>>;
  const validItems: Array<{ id: string; displayName: string }> = [];
  for (const item of rawItems) {
    const id = asNonEmptyString(item.id);
    const displayName = asNonEmptyString(item.displayName);
    if (!id || !displayName) {
      continue;
    }
    validItems.push({ id, displayName });
  }
  if (validItems.length !== rawItems.length) {
    console.warn("[bot] invalid masters filtered from api response", {
      total: rawItems.length,
      valid: validItems.length
    });
  }
  return validItems;
}

async function getTenantTimezoneForConversation(
  routeContext: BotRoutingContext | null = getLegacyRouteContext()
) {
  try {
    if (routeContext?.tenantSlug && apiUrl && internalApiSecret) {
      const response = await fetchWithApiRetry(
        `${apiUrl}/api/v1/public/tenants/${routeContext.tenantSlug}`,
        {
        method: "GET",
          headers: buildInternalHeaders(routeContext, { includeContentType: false })
        }
      );
      const payload = await response.json().catch(() => null);
      const timezone = payload?.data?.timezone;
      if (response.ok && typeof timezone === "string" && timezone) {
        return timezone;
      }
    }
  } catch (error) {
    console.warn("[bot] getTenantTimezoneForConversation fallback", {
      error: toLogError(error)
    });
  }
  return "Europe/Rome";
}

async function getTenantBotConfig(routeContext: BotRoutingContext | null = getLegacyRouteContext()) {
  try {
    if (routeContext?.tenantSlug && apiUrl && internalApiSecret) {
      const response = await fetchWithApiRetry(
        `${apiUrl}/api/v1/public/tenants/${routeContext.tenantSlug}`,
        {
        method: "GET",
          headers: buildInternalHeaders(routeContext, { includeContentType: false })
        }
      );
      const payload = await response.json().catch(() => null);
      if (response.ok && payload?.data) {
        return {
          name: String(payload.data.name ?? "Tenant"),
          defaultLocale: resolveLocale({
            requested:
              payload.data.defaultLocale === "it" || payload.data.defaultLocale === "en"
                ? payload.data.defaultLocale
                : undefined,
            tenantDefault: "it",
            fallback: "en"
          }),
          timezone:
            typeof payload.data.timezone === "string" && payload.data.timezone
              ? payload.data.timezone
              : "Europe/Rome",
          openaiEnabled: payload.data.botConfig?.openaiEnabled !== false,
          openaiModel:
            typeof payload.data.botConfig?.openaiModel === "string" && payload.data.botConfig.openaiModel
              ? payload.data.botConfig.openaiModel
              : openAiModel,
          promptVariant:
            typeof payload.data.botConfig?.promptVariant === "string" &&
            payload.data.botConfig.promptVariant
              ? payload.data.botConfig.promptVariant
              : null,
          humanHandoffEnabled: payload.data.botConfig?.humanHandoffEnabled !== false,
          lateCancelWarnHours: parseNonNegativeNumber(
            payload.data.botConfig?.lateCancelWarnHours,
            botLateCancelWarnHours
          ),
          lateCancelBlockHours: parseNonNegativeNumber(
            payload.data.botConfig?.lateCancelBlockHours,
            botLateCancelBlockHours
          ),
          adminNotificationWhatsappE164:
            typeof payload.data.botConfig?.adminNotificationWhatsappE164 === "string"
              ? payload.data.botConfig.adminNotificationWhatsappE164
              : null,
          faqContent: normalizeTenantFaqContent(payload.data.botConfig?.faqContent),
          terminology: normalizeTenantTerminologyConfig(payload.data.botConfig?.terminology),
          flowConfig: normalizeTenantFlowConfig(payload.data.botConfig?.flowConfig)
        };
      }
    }
  } catch (error) {
    console.warn("[bot] getTenantBotConfig fallback", {
      error: toLogError(error)
    });
  }

  return {
    name: "Tenant",
    defaultLocale: "it" as SupportedLocale,
    timezone: "Europe/Rome",
    openaiEnabled: true,
    openaiModel: openAiModel,
    promptVariant: null as string | null,
    humanHandoffEnabled: true,
    lateCancelWarnHours: botLateCancelWarnHours,
    lateCancelBlockHours: botLateCancelBlockHours,
    adminNotificationWhatsappE164: null as string | null,
    faqContent: normalizeTenantFaqContent(undefined),
    terminology: normalizeTenantTerminologyConfig(undefined),
    flowConfig: normalizeTenantFlowConfig(undefined)
  };
}

function normalizeTenantFaqContent(value: unknown) {
  const root = typeof value === "object" && value ? (value as Record<string, unknown>) : {};
  return {
    it: normalizeTenantFaqLocaleBlock(root.it),
    en: normalizeTenantFaqLocaleBlock(root.en)
  };
}

function normalizeTenantFaqLocaleBlock(value: unknown) {
  const source = typeof value === "object" && value ? (value as Record<string, unknown>) : {};
  return {
    priceInfo: normalizeTenantFaqField(source.priceInfo),
    addressInfo: normalizeTenantFaqField(source.addressInfo),
    parkingInfo: normalizeTenantFaqField(source.parkingInfo),
    workingHoursInfo: normalizeTenantFaqField(source.workingHoursInfo)
  };
}

function normalizeTenantFaqField(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().slice(0, 1000);
}

async function notifyAdminWhatsAppHandoff(input: {
  phone: string;
  summary: string;
  locale: SupportedLocale;
  routeContext?: BotRoutingContext | null;
}) {
  const routeContext = input.routeContext ?? getLegacyRouteContext();
  const config = await getTenantBotConfig(routeContext);
  if (!config.humanHandoffEnabled || !config.adminNotificationWhatsappE164) {
    return false;
  }

  const text =
    input.locale === "it"
      ? `Nuova richiesta di assistenza umana.\nCliente: ${maskPhone(input.phone)}\nTenant: ${config.name}\nRichiesta: ${input.summary}`
      : `New human handoff request.\nClient: ${maskPhone(input.phone)}\nTenant: ${config.name}\nRequest: ${input.summary}`;

  const result = await sendWhatsAppMessage({
    to: config.adminNotificationWhatsappE164,
    text: text.slice(0, 1024),
    routeContext
  });
  return result.sent;
}

function normalizeAbsoluteUrl(input: string): string {
  if (!input) {
    return "";
  }
  if (/^https?:\/\//i.test(input)) {
    return input;
  }
  return `https://${input}`;
}

function getAdminBookingsWebLink(routeContext?: BotRoutingContext | null) {
  const base = normalizeAbsoluteUrl(webUrl).replace(/\/$/, "");
  if (!base) {
    return "";
  }
  const tenantSlug = routeContext?.tenantSlug?.trim();
  if (tenantSlug) {
    return `${base}/t/${encodeURIComponent(tenantSlug)}/app`;
  }
  return `${base}/app`;
}

async function fetchAdminBookingsDigestFromBot(input: {
  adminPhoneE164: string;
  horizon: AdminDigestHorizon;
  routeContext?: BotRoutingContext | null;
}) {
  const routeContext = input.routeContext ?? getLegacyRouteContext();
  if (!apiUrl || !internalApiSecret || (!routeContext?.tenantSlug && !routeContext?.tenantId)) {
    return null;
  }
  const response = await fetchWithApiRetry(`${apiUrl}/api/v1/public/admin/bookings-digest`, {
    method: "POST",
    headers: buildInternalHeaders(routeContext),
    body: JSON.stringify({
      adminPhoneE164: input.adminPhoneE164,
      horizon: input.horizon,
      limit: input.horizon === "next" ? 3 : 12
    })
  });
  if (response.status === 403) {
    return null;
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(payload?.data?.items)) {
    throw new Error(buildBotApiErrorCode("admin_digest_failed", payload));
  }
  return {
    timezone:
      typeof payload.data.timezone === "string" && payload.data.timezone
        ? payload.data.timezone
        : "Europe/Rome",
    items: payload.data.items as Array<{
      id: string;
      clientName: string;
      serviceDisplayName: string;
      status: "pending" | "confirmed" | "completed" | "cancelled" | "rejected" | "no_show";
      startAt: string;
    }>
  };
}

function resolveAdminDigestCommand(input: {
  text?: string;
  replyId?: string;
}): AdminDigestHorizon | "open_web" | null {
  const replyId = input.replyId?.trim().toLowerCase();
  if (replyId === "admin:today") {
    return "today";
  }
  if (replyId === "admin:tomorrow") {
    return "tomorrow";
  }
  if (replyId === "admin:next") {
    return "next";
  }
  if (replyId === "admin:open_web") {
    return "open_web";
  }

  const normalized = input.text?.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === "/today" || normalized === "today" || normalized === "oggi") {
    return "today";
  }
  if (normalized === "/tomorrow" || normalized === "tomorrow" || normalized === "domani") {
    return "tomorrow";
  }
  if (normalized === "/next" || normalized === "next" || normalized === "prossime") {
    return "next";
  }
  if (normalized === "/open" || normalized === "open web") {
    return "open_web";
  }
  return null;
}

function formatAdminDigestMessage(input: {
  locale: SupportedLocale;
  horizon: AdminDigestHorizon;
  timezone: string;
  items: Array<{
    id: string;
    clientName: string;
    serviceDisplayName: string;
    status: string;
    startAt: string;
  }>;
}) {
  const titleMap: Record<AdminDigestHorizon, { it: string; en: string }> = {
    today: { it: "Prenotazioni di oggi", en: "Today bookings" },
    tomorrow: { it: "Prenotazioni di domani", en: "Tomorrow bookings" },
    next: { it: "Prossime prenotazioni", en: "Next bookings" }
  };
  const statusLabel = (status: string) => {
    if (input.locale === "it") {
      if (status === "pending") return "in attesa";
      if (status === "confirmed") return "confermata";
      if (status === "completed") return "completata";
      if (status === "no_show") return "no-show";
      return status;
    }
    if (status === "pending") return "pending";
    if (status === "confirmed") return "confirmed";
    if (status === "completed") return "completed";
    if (status === "no_show") return "no-show";
    return status;
  };

  if (input.items.length === 0) {
    return input.locale === "it"
      ? `${titleMap[input.horizon].it}: nessuna prenotazione.`
      : `${titleMap[input.horizon].en}: no bookings found.`;
  }

  const toDateTimeLabel = (value: string) => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: input.timezone
    }).formatToParts(new Date(value));
    const map = new Map(parts.map((part) => [part.type, part.value]));
    const day = map.get("day") ?? "01";
    const month = map.get("month") ?? "01";
    const year = map.get("year") ?? "1970";
    const hour = map.get("hour") ?? "00";
    const minute = map.get("minute") ?? "00";
    return `${day}.${month}.${year} ${hour}:${minute}`;
  };
  const rows = input.items.map((item, index) => {
    const when = toDateTimeLabel(item.startAt);
    return `${index + 1}. ${when} - ${item.clientName} - ${item.serviceDisplayName} (${statusLabel(item.status)})`;
  });
  return `${input.locale === "it" ? titleMap[input.horizon].it : titleMap[input.horizon].en}\n${rows.join("\n")}`;
}

function getAdminDigestButtons(input: { locale: SupportedLocale; horizon: AdminDigestHorizon }): WhatsAppChoice[] {
  if (input.horizon === "today") {
    return [
      { id: "admin:tomorrow", title: input.locale === "it" ? "Domani" : "Tomorrow" },
      { id: "admin:next", title: input.locale === "it" ? "Prossime" : "Next" },
      { id: "admin:open_web", title: input.locale === "it" ? "Apri web" : "Open web" }
    ];
  }
  if (input.horizon === "tomorrow") {
    return [
      { id: "admin:today", title: input.locale === "it" ? "Oggi" : "Today" },
      { id: "admin:next", title: input.locale === "it" ? "Prossime" : "Next" },
      { id: "admin:open_web", title: input.locale === "it" ? "Apri web" : "Open web" }
    ];
  }
  return [
    { id: "admin:today", title: input.locale === "it" ? "Oggi" : "Today" },
    { id: "admin:tomorrow", title: input.locale === "it" ? "Domani" : "Tomorrow" },
    { id: "admin:open_web", title: input.locale === "it" ? "Apri web" : "Open web" }
  ];
}

async function handleAdminDigestCommand(input: {
  from: string;
  text?: string;
  replyId?: string;
  locale: SupportedLocale;
  routeContext?: BotRoutingContext | null;
}) {
  const routeContext = input.routeContext ?? getLegacyRouteContext();
  const command = resolveAdminDigestCommand({
    text: input.text,
    replyId: input.replyId
  });
  if (!command) {
    return false;
  }

  if (command === "open_web") {
    const authProbe = await fetchAdminBookingsDigestFromBot({
      adminPhoneE164: input.from,
      horizon: "next",
      routeContext
    }).catch(() => null);
    if (!authProbe) {
      bumpRuntimeCounter("adminDigestErrors");
      return false;
    }
    const link = getAdminBookingsWebLink(routeContext);
    if (!link) {
      await sendWhatsAppMessage({
        to: input.from,
        text: input.locale === "it" ? "Link web non configurato." : "Web link is not configured.",
        routeContext
      });
      return true;
    }
    await sendWhatsAppMessage({
      to: input.from,
      text:
        input.locale === "it" ? `Apri dashboard prenotazioni: ${link}` : `Open bookings dashboard: ${link}`,
      routeContext
    });
    return true;
  }

  let digest;
  try {
    digest = await fetchAdminBookingsDigestFromBot({
      adminPhoneE164: input.from,
      horizon: command,
      routeContext
    });
  } catch (error) {
    bumpRuntimeCounter("adminDigestErrors");
    await emitOpsAlert({
      event: "admin_digest_fetch_failed",
      severity: "warning",
      context: {
        from: maskPhone(input.from),
        horizon: command,
        error: toLogError(error)
      }
    });
    await sendWhatsAppMessage({
      to: input.from,
      text:
        input.locale === "it"
          ? "Impossibile caricare ora la lista prenotazioni."
          : "Unable to load booking list right now.",
      routeContext
    });
    return true;
  }

  if (!digest) {
    bumpRuntimeCounter("adminDigestErrors");
    return false;
  }

  bumpRuntimeCounter("adminDigestHandled");
  console.info("[bot][admin-digest] handled", {
    from: maskPhone(input.from),
    horizon: command,
    total: digest.items.length
  });

  const summaryText = formatAdminDigestMessage({
    locale: input.locale,
    horizon: command,
    timezone: digest.timezone,
    items: digest.items
  });
  const link = getAdminBookingsWebLink(routeContext);
  const withLink = link
    ? `${summaryText}\n\n${input.locale === "it" ? "Apri web:" : "Open web:"} ${link}`
    : summaryText;
  await sendWhatsAppMessage({
    to: input.from,
    text: withLink.slice(0, 3500),
    routeContext
  });
  const firstPending = digest.items.find((item) => item.status === "pending");
  if (firstPending) {
    const confirmToken = buildBookingActionTokenForBot({
      action: "admin_confirm",
      bookingId: firstPending.id,
      phoneE164: input.from,
      ttlMinutes: 30
    });
    const rejectToken = buildBookingActionTokenForBot({
      action: "admin_reject",
      bookingId: firstPending.id,
      phoneE164: input.from,
      ttlMinutes: 30
    });
    if (confirmToken && rejectToken) {
      await sendWhatsAppButtons({
        to: input.from,
        bodyText:
          input.locale === "it"
            ? "Prossima prenotazione in attesa: scegli azione."
            : "Next pending booking: choose action.",
        choices: [
          {
            id: `cta:${confirmToken}`,
            title: input.locale === "it" ? "Conferma" : "Confirm"
          },
          {
            id: `cta:${rejectToken}`,
            title: input.locale === "it" ? "Rifiuta" : "Reject"
          },
          {
            id: "admin:open_web",
            title: input.locale === "it" ? "Apri web" : "Open web"
          }
        ],
        routeContext
      });
      return true;
    }
  }
  await sendWhatsAppButtons({
    to: input.from,
    bodyText: input.locale === "it" ? "Azioni rapide amministratore:" : "Administrator quick actions:",
    choices: getAdminDigestButtons({
      locale: input.locale,
      horizon: command
    }),
    routeContext
  });
  return true;
}

async function fetchServiceDuration(
  serviceId: string,
  routeContext: BotRoutingContext | null = getLegacyRouteContext()
): Promise<number | null> {
  if (!apiUrl || !internalApiSecret || (!routeContext?.tenantSlug && !routeContext?.tenantId)) {
    return null;
  }
  const response = await fetchWithApiRetry(`${apiUrl}/api/v1/public/services?locale=en`, {
    method: "GET",
    headers: buildInternalHeaders(routeContext, { includeContentType: false })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(payload?.data?.items)) {
    return null;
  }

  const service = payload.data.items.find((item: { id?: string; durationMinutes?: unknown }) => item.id === serviceId);
  if (!service || !Number.isInteger(service.durationMinutes)) {
    return null;
  }
  return Number(service.durationMinutes);
}

async function createBookingFromBot(input: {
  serviceId: string;
  startAtIso: string;
  phone: string;
  locale: SupportedLocale;
  source: "telegram" | "whatsapp";
  chatId?: number;
  masterId?: string;
  clientName?: string;
  routeContext?: BotRoutingContext | null;
}) {
  const routeContext = input.routeContext ?? getLegacyRouteContext();
  if (!apiUrl || !internalApiSecret || (!routeContext?.tenantSlug && !routeContext?.tenantId)) {
    throw new Error("bot_api_config_missing");
  }

  const durationMinutes = await fetchServiceDuration(input.serviceId, routeContext);
  if (!durationMinutes) {
    throw new Error("service_not_found_or_duration_missing");
  }

  const startAt = new Date(input.startAtIso);
  if (Number.isNaN(startAt.getTime())) {
    throw new Error("invalid_startAt");
  }
  const endAt = new Date(startAt.getTime() + durationMinutes * 60 * 1000);
  const idempotencyKey = randomUUID();

  const response = await fetchWithApiRetry(`${apiUrl}/api/v1/public/bookings`, {
    method: "POST",
    headers: {
      ...buildInternalHeaders(routeContext),
      "idempotency-key": idempotencyKey
    },
    body: JSON.stringify({
      serviceId: input.serviceId,
      masterId: input.masterId,
      source: input.source,
      clientName: input.clientName ?? (input.source === "whatsapp" ? "WhatsApp Client" : "Telegram Client"),
      clientPhoneE164: input.phone,
      clientLocale: input.locale,
      clientConsent: true,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      clientTelegramChatId: input.chatId
    })
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(buildBotApiErrorCode("booking_create_failed", payload));
  }

  return payload?.data?.bookingId ? String(payload.data.bookingId) : "ok";
}

async function cancelBookingFromBot(input: {
  bookingId: string;
  phone: string;
  routeContext?: BotRoutingContext | null;
}) {
  const routeContext = input.routeContext ?? getLegacyRouteContext();
  if (!apiUrl || !internalApiSecret || (!routeContext?.tenantSlug && !routeContext?.tenantId)) {
    throw new Error("bot_api_config_missing");
  }

  const response = await fetchWithApiRetry(`${apiUrl}/api/v1/public/bookings/${input.bookingId}/cancel`, {
    method: "POST",
    headers: {
      ...buildInternalHeaders(routeContext),
      "idempotency-key": randomUUID()
    },
    body: JSON.stringify({
      clientPhoneE164: input.phone,
      reason: "Cancelled via telegram bot"
    })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(buildBotApiErrorCode("booking_cancel_failed", payload));
  }

  return payload?.data?.id ? String(payload.data.id) : input.bookingId;
}

async function rescheduleBookingFromBot(input: {
  bookingId: string;
  phone: string;
  serviceId: string;
  masterId?: string;
  startAtIso: string;
  locale: SupportedLocale;
  routeContext?: BotRoutingContext | null;
}) {
  const routeContext = input.routeContext ?? getLegacyRouteContext();
  if (!apiUrl || !internalApiSecret || (!routeContext?.tenantSlug && !routeContext?.tenantId)) {
    throw new Error("bot_api_config_missing");
  }

  const durationMinutes = await fetchServiceDuration(input.serviceId, routeContext);
  if (!durationMinutes) {
    throw new Error("service_not_found_or_duration_missing");
  }

  const startAt = new Date(input.startAtIso);
  if (Number.isNaN(startAt.getTime())) {
    throw new Error("invalid_startAt");
  }
  const endAt = new Date(startAt.getTime() + durationMinutes * 60 * 1000);
  const response = await fetchWithApiRetry(`${apiUrl}/api/v1/public/bookings/${input.bookingId}/reschedule`, {
    method: "POST",
    headers: {
      ...buildInternalHeaders(routeContext),
      "idempotency-key": randomUUID()
    },
    body: JSON.stringify({
      clientPhoneE164: input.phone,
      serviceId: input.serviceId,
      masterId: input.masterId,
      clientLocale: input.locale,
      source: "whatsapp",
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString()
    })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(buildBotApiErrorCode("booking_reschedule_failed", payload));
  }

  return payload?.data?.newBookingId ? String(payload.data.newBookingId) : "ok";
}

function buildBotApiErrorCode(fallback: string, payload: unknown): string {
  const message =
    typeof (payload as { error?: { message?: unknown } } | null)?.error?.message === "string"
      ? ((payload as { error: { message: string } }).error.message)
      : undefined;
  const details = (payload as { error?: { details?: unknown } } | null)?.error?.details;
  const reason =
    typeof (details as { reason?: unknown } | null)?.reason === "string"
      ? ((details as { reason: string }).reason)
      : undefined;
  if (reason) {
    return `${fallback}:${reason}`;
  }
  if (message) {
    return `${fallback}:${message.toLowerCase().replace(/\s+/g, "_")}`;
  }
  return fallback;
}

async function applyAdminBookingActionFromBot(input: {
  bookingId: string;
  adminPhoneE164: string;
  action: "confirm" | "reject";
  rejectionReason?: string;
  routeContext?: BotRoutingContext | null;
}) {
  const routeContext = input.routeContext ?? getLegacyRouteContext();
  if (!apiUrl || !internalApiSecret || (!routeContext?.tenantSlug && !routeContext?.tenantId)) {
    throw new Error("bot_api_config_missing");
  }

  const response = await fetchWithApiRetry(`${apiUrl}/api/v1/public/bookings/${input.bookingId}/admin-action`, {
    method: "POST",
    headers: {
      ...buildInternalHeaders(routeContext),
      "idempotency-key": randomUUID()
    },
    body: JSON.stringify({
      adminPhoneE164: input.adminPhoneE164,
      action: input.action,
      rejectionReason: input.rejectionReason
    })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    console.warn("[bot][admin-action] request failed", {
      bookingId: input.bookingId,
      action: input.action,
      status: response.status,
      reason: payload?.error?.details?.reason ?? null
    });
    throw new Error(payload?.error?.message ?? "booking_admin_action_failed");
  }
  console.log("[bot][admin-action] request completed", {
    bookingId: input.bookingId,
    action: input.action,
    applied: payload?.data?.applied !== false,
    resultingStatus: payload?.data?.status ?? null
  });
  return {
    bookingId: String(payload?.data?.bookingId ?? input.bookingId),
    status: String(payload?.data?.status ?? ""),
    applied: payload?.data?.applied !== false
  };
}

async function listBookingsByPhoneFromBot(input: {
  phone: string;
  limit?: number;
  routeContext?: BotRoutingContext | null;
}): Promise<
  Array<{
    id: string;
    startAt: string;
    status: string;
    clientName?: string;
    serviceId: string;
    masterId?: string;
    clientLocale?: SupportedLocale;
  }>
> {
  const routeContext = input.routeContext ?? getLegacyRouteContext();
  if (!apiUrl || !internalApiSecret || (!routeContext?.tenantSlug && !routeContext?.tenantId)) {
    return [] as Array<{
      id: string;
      startAt: string;
      status: string;
      clientName?: string;
      serviceId: string;
      masterId?: string;
      clientLocale?: SupportedLocale;
    }>;
  }
  const params = new URLSearchParams({
    clientPhoneE164: input.phone
  });
  if (input.limit && Number.isFinite(input.limit)) {
    params.set("limit", String(Math.trunc(input.limit)));
  }
  const response = await fetchWithApiRetry(`${apiUrl}/api/v1/public/bookings?${params.toString()}`, {
    method: "GET",
    headers: buildInternalHeaders(routeContext, { includeContentType: false })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(payload?.data?.items)) {
    return [] as Array<{
      id: string;
      startAt: string;
      status: string;
      clientName?: string;
      serviceId: string;
      masterId?: string;
      clientLocale?: SupportedLocale;
    }>;
  }
  const rawItems = payload.data.items as Array<Record<string, unknown>>;
  const validItems: Array<{
    id: string;
    startAt: string;
    status: string;
    clientName?: string;
    serviceId: string;
    masterId?: string;
    clientLocale?: SupportedLocale;
  }> = [];
  for (const item of rawItems) {
    const id = asNonEmptyString(item.id);
    const startAt = asNonEmptyString(item.startAt);
    const status = asNonEmptyString(item.status);
    const serviceId = asNonEmptyString(item.serviceId);
    if (!id || !startAt || !status || !serviceId) {
      continue;
    }
    validItems.push({
      id,
      startAt,
      status,
      clientName: asNonEmptyString(item.clientName) ?? undefined,
      serviceId,
      masterId: asNonEmptyString(item.masterId) ?? undefined,
      clientLocale:
        item.clientLocale === "it" || item.clientLocale === "en"
          ? (item.clientLocale as SupportedLocale)
          : undefined
    });
  }
  if (validItems.length !== rawItems.length) {
    console.warn("[bot] invalid bookings filtered from api response", {
      total: rawItems.length,
      valid: validItems.length
    });
  }
  return validItems;
}

function parseCtaToken(replyId?: string) {
  if (!replyId?.startsWith("cta:")) {
    return null;
  }
  return replyId.slice(4);
}

function buildBookingActionTokenForBot(input: {
  action: BookingActionType;
  bookingId: string;
  phoneE164: string;
  ttlMinutes?: number;
}) {
  if (!waActionTokenSecret) {
    return null;
  }
  const expiresAtUnix = Math.floor(Date.now() / 1000) + (input.ttlMinutes ?? 60) * 60;
  return createBookingActionToken(
    {
      action: input.action,
      bookingId: input.bookingId,
      phoneE164: input.phoneE164,
      expiresAtUnix
    },
    waActionTokenSecret
  );
}

function getNextDays(timezone: string, count: number) {
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

function formatDateChoiceLabel(dateIso: string, _locale: SupportedLocale, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone
  }).formatToParts(new Date(`${dateIso}T00:00:00.000Z`));
  const map = new Map(parts.map((part) => [part.type, part.value]));
  const day = map.get("day") ?? "01";
  const month = map.get("month") ?? "01";
  const year = map.get("year") ?? "1970";
  return `${day}.${month}.${year}`;
}

async function sendRescheduleDateChoices(input: {
  to: string;
  locale: SupportedLocale;
  serviceId: string;
  masterId?: string;
  routeContext?: BotRoutingContext | null;
}) {
  const routeContext = input.routeContext ?? getLegacyRouteContext();
  const timezone = await getTenantTimezoneForConversation(routeContext);
  const dates = getNextDays(timezone, 10);
  const choices: Array<{ id: string; title: string; description?: string }> = [];
  for (const date of dates) {
    const slots = await fetchSlotsFromApi({
      serviceId: input.serviceId,
      masterId: input.masterId,
      date,
      locale: input.locale,
      routeContext
    });
    if (slots.length === 0) {
      continue;
    }
    choices.push({
      id: `date:${date}`,
      title: formatDateChoiceLabel(date, input.locale, timezone),
      description:
        input.locale === "it" ? `${slots.length} slot disponibili` : `${slots.length} slots available`
    });
  }
  if (choices.length === 0) {
    await sendWhatsAppMessage({
      to: input.to,
      text:
        input.locale === "it"
          ? "Non trovo slot disponibili per il trasferimento in questo momento."
          : "I cannot find available slots for rescheduling right now.",
      routeContext
    });
    return;
  }
  await sendWhatsAppList({
    to: input.to,
    bodyText:
      input.locale === "it"
        ? "Scegli una nuova data per la prenotazione."
        : "Choose a new date for your booking.",
    buttonText: input.locale === "it" ? "Date" : "Dates",
    choices: [
      ...choices.slice(0, 8),
      { id: "flow:back", title: input.locale === "it" ? "Indietro" : "Back" },
      { id: "flow:restart", title: input.locale === "it" ? "Inizio" : "Start over" }
    ],
    routeContext
  });
}

async function sendBookingConflictRecoveryChoices(input: {
  to: string;
  locale: SupportedLocale;
  serviceId: string;
  masterId?: string;
  selectedDate: string;
  routeContext?: BotRoutingContext | null;
}) {
  const routeContext = input.routeContext ?? getLegacyRouteContext();
  const emptySlots: Array<{ startAt: string; displayTime: string }> = [];
  const sameDateSlots = await fetchSlotsFromApi({
    serviceId: input.serviceId,
    masterId: input.masterId,
    date: input.selectedDate,
    locale: input.locale,
    routeContext
  }).catch(() => emptySlots);

  if (sameDateSlots.length > 0) {
    const choices = sameDateSlots.slice(0, 8).map((slot: { startAt: string; displayTime: string }) => ({
      id: `slot:${encodeURIComponent(slot.startAt)}`,
      title: slot.displayTime
    }));
    await sendWhatsAppList({
      to: input.to,
      bodyText:
        input.locale === "it"
          ? "Questo orario non e piu disponibile. Scegli un altro orario."
          : "This slot is no longer available. Please choose another time.",
      buttonText: input.locale === "it" ? "Orari" : "Times",
      choices: [
        ...choices,
        { id: "flow:back", title: input.locale === "it" ? "Indietro" : "Back" },
        { id: "flow:restart", title: input.locale === "it" ? "Inizio" : "Start over" }
      ].slice(0, 10),
      routeContext
    });
    return;
  }

  const timezone = await getTenantTimezoneForConversation(routeContext);
  const dates = getNextDays(timezone, 10).filter((date) => date !== input.selectedDate);
  const dateChoices: Array<{ id: string; title: string; description?: string }> = [];
  for (const date of dates) {
    const slots = await fetchSlotsFromApi({
      serviceId: input.serviceId,
      masterId: input.masterId,
      date,
      locale: input.locale,
      routeContext
    }).catch(() => []);
    if (slots.length === 0) {
      continue;
    }
    dateChoices.push({
      id: `date:${date}`,
      title: formatDateChoiceLabel(date, input.locale, timezone),
      description:
        input.locale === "it" ? `${slots.length} slot disponibili` : `${slots.length} slots available`
    });
    if (dateChoices.length >= 8) {
      break;
    }
  }

  if (dateChoices.length > 0) {
    await sendWhatsAppList({
      to: input.to,
      bodyText:
        input.locale === "it"
          ? "Non ci sono altri orari in questa data. Scegli una nuova data."
          : "No more times are available on this date. Please choose a new date.",
      buttonText: input.locale === "it" ? "Date" : "Dates",
      choices: [
        ...dateChoices,
        { id: "flow:back", title: input.locale === "it" ? "Indietro" : "Back" },
        { id: "flow:restart", title: input.locale === "it" ? "Inizio" : "Start over" }
      ].slice(0, 10),
      routeContext
    });
    return;
  }

  await sendWhatsAppMessage({
    to: input.to,
    text:
      input.locale === "it"
        ? "Al momento non trovo slot alternativi. Riprova tra poco."
        : "I cannot find alternative slots right now. Please try again shortly.",
    routeContext
  });
}

function isSlotConflictErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }
  const text = error.message.toLowerCase();
  return (
    text.includes("booking_create_failed:conflict") ||
    text.includes("booking_reschedule_failed:conflict") ||
    text.includes("booking_status_changed_concurrently")
  );
}

function isBackendTemporarilyUnavailableError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }
  const text = error.message.toLowerCase();
  return (
    text.includes("api_retryable_status:") ||
    text.includes("api_retry_failed") ||
    text.includes("service_unavailable") ||
    text.includes("gateway_timeout") ||
    text.includes("timeout") ||
    text.includes("internal_error")
  );
}

async function handleWhatsAppCtaReply(input: {
  from: string;
  replyId: string;
  locale: SupportedLocale;
  routeContext?: BotRoutingContext | null;
}) {
  const routeContext = input.routeContext ?? getLegacyRouteContext();
  const token = parseCtaToken(input.replyId);
  if (!token || !waActionTokenSecret) {
    return false;
  }

  const verified = verifyBookingActionToken(token, waActionTokenSecret);
  if (!verified.ok) {
    await sendWhatsAppMessage({
      to: input.from,
      text:
        input.locale === "it"
          ? "Azione non valida o scaduta. Riprova dal menu."
          : "Action is invalid or expired. Please retry from the menu.",
      routeContext
    });
    console.warn("[bot] cta action rejected", {
      from: maskPhone(input.from),
      reason: verified.reason
    });
    return true;
  }

  const action = verified.payload.action;
  const bookingId = verified.payload.bookingId;
  const ownerPhone = verified.payload.phoneE164;

  console.info("[bot] cta action received", {
    from: maskPhone(input.from),
    action,
    bookingId: maskIdentifier(bookingId)
  });

  if (action.startsWith("client_") && ownerPhone !== input.from) {
    await sendWhatsAppMessage({
      to: input.from,
      text: input.locale === "it" ? "Azione non autorizzata." : "Unauthorized action.",
      routeContext
    });
    return true;
  }

  if (action.startsWith("admin_") && ownerPhone !== input.from) {
    await sendWhatsAppMessage({
      to: input.from,
      text: input.locale === "it" ? "Azione admin non autorizzata." : "Unauthorized admin action.",
      routeContext
    });
    return true;
  }

  if (action.startsWith("flow_") && ownerPhone !== input.from) {
    await sendWhatsAppMessage({
      to: input.from,
      text: input.locale === "it" ? "Azione non autorizzata." : "Unauthorized action.",
      routeContext
    });
    return true;
  }

  if (action === "client_confirm") {
    await sendWhatsAppMessage({
      to: input.from,
      text:
        input.locale === "it"
          ? "Perfetto, confermato. Ti aspettiamo."
          : "Great, confirmed. We look forward to seeing you.",
      routeContext
    });
    return true;
  }

  if (action === "client_cancel_init") {
    const confirmToken = buildBookingActionTokenForBot({
      action: "client_cancel_confirm",
      bookingId,
      phoneE164: ownerPhone,
      ttlMinutes: 20
    });
    if (!confirmToken) {
      await sendWhatsAppMessage({
        to: input.from,
        text:
          input.locale === "it"
            ? "Impossibile confermare l'annullamento ora."
            : "Cannot confirm cancellation right now.",
        routeContext
      });
      return true;
    }
    await sendWhatsAppButtons({
      to: input.from,
      bodyText:
        input.locale === "it"
          ? "Sei sicuro di voler annullare questa prenotazione?"
          : "Are you sure you want to cancel this booking?",
      choices: [
        { id: `cta:${confirmToken}`, title: input.locale === "it" ? "Si, annulla" : "Yes, cancel" },
        { id: "flow:restart", title: input.locale === "it" ? "No" : "No" }
      ],
      routeContext
    });
    return true;
  }

  if (action === "client_cancel_confirm") {
    try {
      await cancelBookingFromBot({
        bookingId,
        phone: ownerPhone,
        routeContext
      });
      await sendWhatsAppMessage({
        to: input.from,
        text: input.locale === "it" ? "Prenotazione annullata." : "Booking cancelled.",
        routeContext
      });
    } catch {
      await sendWhatsAppMessage({
        to: input.from,
        text:
          input.locale === "it"
            ? "Impossibile annullare la prenotazione. Verifica lo stato."
            : "Unable to cancel the booking. Please verify its current status.",
        routeContext
      });
    }
    return true;
  }

  if (action === "client_reschedule") {
    const bookings = await listBookingsByPhoneFromBot({
      phone: ownerPhone,
      limit: 20,
      routeContext
    });
    const booking = bookings.find((item) => item.id === bookingId && (item.status === "pending" || item.status === "confirmed"));
    if (!booking) {
      await sendWhatsAppMessage({
        to: input.from,
        text:
          input.locale === "it"
            ? "Non trovo una prenotazione attiva da spostare."
            : "I cannot find an active booking to reschedule.",
        routeContext
      });
      return true;
    }
    const session = createInitialSession(input.locale);
    session.currentMode = "ai_assisted";
    session.intent = "reschedule_booking";
    session.state = "choose_date";
    session.bookingIdToReschedule = booking.id;
    session.serviceId = booking.serviceId;
    session.masterId = booking.masterId;
    session.lastUserMessageAt = new Date().toISOString();
    await saveWhatsAppSession(input.from, session, routeContext);
    await sendRescheduleDateChoices({
      to: input.from,
      locale: input.locale,
      serviceId: booking.serviceId,
      masterId: booking.masterId,
      routeContext
    });
    return true;
  }

  if (action === "flow_confirm_booking") {
    const session = await loadWhatsAppSession(input.from, routeContext);
    if (
      !session ||
      session.state !== "confirm" ||
      session.intent === "cancel_booking" ||
      !session.serviceId ||
      !session.slotStartAt
    ) {
      await sendWhatsAppMessage({
        to: input.from,
        text:
          input.locale === "it"
            ? "Sessione scaduta. Riprova dal menu."
            : "Session expired. Please retry from the menu.",
        routeContext
      });
      await clearWhatsAppSession(input.from, routeContext);
      return true;
    }

    try {
      if (session.intent === "reschedule_booking" && session.bookingIdToReschedule) {
        await rescheduleBookingFromBot({
          bookingId: session.bookingIdToReschedule,
          phone: input.from,
          serviceId: session.serviceId,
          masterId: session.masterId,
          startAtIso: session.slotStartAt,
          locale: session.locale,
          routeContext
        });
        await sendWhatsAppMessage({
          to: input.from,
          text:
            session.locale === "it"
              ? "Prenotazione spostata con successo."
              : "Booking rescheduled successfully.",
          routeContext
        });
      } else {
        await createBookingFromBot({
          serviceId: session.serviceId,
          startAtIso: session.slotStartAt,
          phone: input.from,
          locale: session.locale,
          source: "whatsapp",
          masterId: session.masterId,
          clientName: session.clientName ?? "WhatsApp Client",
          routeContext
        });
        await sendWhatsAppMessage({
          to: input.from,
          text:
            session.locale === "it"
              ? "Richiesta prenotazione ricevuta. Attendi conferma dall'amministratore."
              : "Booking request received. Please wait for admin confirmation.",
          routeContext
        });
      }
    } catch (error) {
      if (isSlotConflictErrorMessage(error)) {
        const selectedDate = session.date ?? session.slotStartAt?.slice(0, 10) ?? "";
        session.state = "choose_slot";
        session.slotPage = 0;
        session.slotStartAt = undefined;
        session.slotDisplayTime = undefined;
        await saveWhatsAppSession(input.from, session, routeContext);
        await sendBookingConflictRecoveryChoices({
          to: input.from,
          locale: session.locale,
          serviceId: session.serviceId,
          masterId: session.masterId,
          selectedDate,
          routeContext
        });
        return true;
      }
      if (isBackendTemporarilyUnavailableError(error)) {
        await sendWhatsAppMessage({
          to: input.from,
          text:
            input.locale === "it"
              ? "Ho una difficolta tecnica temporanea. Riprova tra qualche minuto."
              : "I have a temporary technical issue. Please try again in a few minutes.",
          routeContext
        });
        return true;
      }
      await sendWhatsAppMessage({
        to: input.from,
        text:
          input.locale === "it"
            ? "Non riesco a completare l'operazione ora. Riprova dal menu."
            : "Unable to complete the action now. Please retry from the menu.",
        routeContext
      });
    }
    await clearWhatsAppSession(input.from, routeContext);
    return true;
  }

  if (action === "flow_confirm_cancel") {
    const session = await loadWhatsAppSession(input.from, routeContext);
    const bookingIdToCancel = session?.bookingIdInContext ?? bookingId;
    if (
      !bookingIdToCancel ||
      (session?.bookingIdInContext && session.bookingIdInContext !== bookingId)
    ) {
      await sendWhatsAppMessage({
        to: input.from,
        text:
          input.locale === "it"
            ? "Sessione scaduta. Riprova dal menu."
            : "Session expired. Please retry from the menu.",
        routeContext
      });
      await clearWhatsAppSession(input.from, routeContext);
      return true;
    }
    try {
      await cancelBookingFromBot({
        bookingId: bookingIdToCancel,
        phone: ownerPhone,
        routeContext
      });
      await sendWhatsAppMessage({
        to: input.from,
        text: input.locale === "it" ? "Prenotazione annullata." : "Booking cancelled.",
        routeContext
      });
    } catch {
      await sendWhatsAppMessage({
        to: input.from,
        text:
          input.locale === "it"
            ? "Impossibile annullare la prenotazione. Verifica lo stato."
            : "Unable to cancel the booking. Please verify its current status.",
        routeContext
      });
    }
    await clearWhatsAppSession(input.from, routeContext);
    return true;
  }

  if (action === "admin_confirm") {
    console.log("[bot][admin-action] confirm clicked", { bookingId, from: input.from });
    try {
      const result = await applyAdminBookingActionFromBot({
        bookingId,
        adminPhoneE164: ownerPhone,
        action: "confirm",
        routeContext
      });
      await sendWhatsAppMessage({
        to: input.from,
        text:
          !result.applied
            ? input.locale === "it"
              ? "Questa prenotazione e gia stata gestita."
              : "This booking has already been processed."
            : result.status === "confirmed"
            ? "Booking confirmed."
            : result.status === "cancelled"
              ? "Booking cancelled."
              : "Action applied.",
        routeContext
      });
    } catch {
      await sendWhatsAppMessage({
        to: input.from,
        text: "Unable to apply admin action.",
        routeContext
      });
    }
    return true;
  }

  if (action === "admin_cancel" || action === "admin_reject") {
    console.log("[bot][admin-action] reject clicked", { bookingId, from: input.from });
    const expiresAtUnix = Math.floor(Date.now() / 1000) + adminRejectReasonTtlSeconds;
    await saveAdminRejectPending(
      input.from,
      {
        bookingId,
        adminPhoneE164: ownerPhone,
        locale: input.locale,
        expiresAtUnix
      },
      routeContext
    );
    await sendWhatsAppMessage({
      to: input.from,
      text:
        input.locale === "it"
          ? "Invia ora la motivazione del rifiuto con il prossimo messaggio."
          : "Please send the rejection reason in your next message.",
      routeContext
    });
    console.log("[bot][admin-action] awaiting rejection reason", {
      bookingId,
      from: input.from,
      expiresAtUnix
    });
    return true;
  }

  return false;
}

async function handlePendingAdminRejectReason(input: {
  from: string;
  text?: string;
  locale: SupportedLocale;
  routeContext?: BotRoutingContext | null;
}) {
  const routeContext = input.routeContext ?? getLegacyRouteContext();
  if (!input.text?.trim()) {
    return false;
  }

  const pending = await loadAdminRejectPending(input.from, routeContext);
  if (!pending) {
    return false;
  }

  if (pending.expiresAtUnix < Math.floor(Date.now() / 1000)) {
    await clearAdminRejectPending(input.from, routeContext);
    await sendWhatsAppMessage({
      to: input.from,
      text:
        input.locale === "it"
          ? "Azione scaduta. Apri una nuova richiesta dal messaggio di prenotazione."
          : "Action expired. Start again from the booking message.",
      routeContext
    });
    return true;
  }

  const reason = input.text.trim();
  console.log("[bot][admin-action] rejection reason received", {
    bookingId: pending.bookingId,
    from: input.from,
    reasonLength: reason.length
  });
  if (reason.length < 3) {
    await sendWhatsAppMessage({
      to: input.from,
      text:
        input.locale === "it"
          ? "Inserisci una motivazione piu dettagliata per il rifiuto."
          : "Please provide a more detailed rejection reason.",
      routeContext
    });
    return true;
  }

  try {
    const result = await applyAdminBookingActionFromBot({
      bookingId: pending.bookingId,
      adminPhoneE164: pending.adminPhoneE164,
      action: "reject",
      rejectionReason: reason,
      routeContext
    });
    await clearAdminRejectPending(input.from, routeContext);
    await sendWhatsAppMessage({
      to: input.from,
      text:
        !result.applied
          ? input.locale === "it"
            ? "Questa prenotazione e gia stata gestita."
            : "This booking has already been processed."
          : input.locale === "it"
            ? "Prenotazione rifiutata e cliente avvisato."
            : "Booking rejected and client notified.",
      routeContext
    });
    console.log("[bot][admin-action] rejection applied", {
      bookingId: pending.bookingId,
      from: input.from,
      applied: result.applied,
      resultingStatus: result.status
    });
  } catch {
    await sendWhatsAppMessage({
      to: input.from,
      text:
        input.locale === "it"
          ? "Impossibile applicare il rifiuto ora. Riprova."
          : "Unable to apply rejection now. Please retry.",
      routeContext
    });
  }

  return true;
}

async function buildStaticReply(
  text: string,
  locale: SupportedLocale,
  routeContext: BotRoutingContext | null = getLegacyRouteContext()
) {
  const normalized = text.trim().toLowerCase();
  if (normalized === "/start" || normalized === "/help") {
    return [
      t("bot.greeting.formal", { locale }),
      locale === "it"
        ? "Puoi scrivere: /slots, /book o /cancel."
        : "You can type: /slots, /book or /cancel."
    ].join("\n");
  }

  if (normalized === "/slots") {
    return locale === "it"
      ? "Controllo la disponibilita. Indica servizio e data (YYYY-MM-DD)."
      : "I am checking availability. Please provide service and date (YYYY-MM-DD).";
  }
  if (normalized.startsWith("/slots ")) {
    const parts = text.trim().split(/\s+/);
    const serviceId = parts[1];
    const date = parts[2];
    const masterId = parts[3];

    if (!serviceId || !date) {
      return locale === "it"
        ? "Formato: /slots <serviceId> <YYYY-MM-DD> [masterId]"
        : "Format: /slots <serviceId> <YYYY-MM-DD> [masterId]";
    }

    try {
      const slots = await fetchSlotsFromApi({ serviceId, date, masterId, locale, routeContext });
      if (slots.length === 0) {
        return locale === "it"
          ? "Nessuna disponibilita trovata."
          : "No availability found.";
      }

      const top = slots
        .slice(0, 10)
        .map((item: { displayTime?: string }) => item.displayTime ?? "?")
        .join(", ");
      return locale === "it"
        ? `Disponibilita: ${top}`
        : `Available slots: ${top}`;
    } catch {
      return locale === "it"
        ? "Impossibile ottenere disponibilita al momento."
        : "Unable to fetch availability right now.";
    }
  }

  if (normalized === "/book") {
    return locale === "it"
      ? "Per prenotare, indica servizio, data, ora e numero di telefono in formato E.164."
      : "To create a booking, provide service, date, time and phone number in E.164 format.";
  }
  if (normalized.startsWith("/book ")) {
    return locale === "it"
      ? "Formato: /book <serviceId> <startAtISO> <phoneE164> [masterId] [nome]"
      : "Format: /book <serviceId> <startAtISO> <phoneE164> [masterId] [name]";
  }

  if (normalized === "/cancel") {
    return locale === "it"
      ? "Per annullare, invia il codice prenotazione."
      : "To cancel, send your booking code.";
  }
  if (normalized.startsWith("/cancel ")) {
    return locale === "it"
      ? "Formato: /cancel <bookingId> <phoneE164>"
      : "Format: /cancel <bookingId> <phoneE164>";
  }

  return null;
}

async function generateAiReply(input: { text: string; locale: SupportedLocale }) {
  if (!openAiApiKey) {
    return input.locale === "it"
      ? "Messaggio ricevuto. Un operatore la ricontattera a breve."
      : "Message received. An operator will contact you shortly.";
  }

  const systemPrompt =
    input.locale === "it"
      ? "Sei un assistente formale per prenotazioni. Rispondi in italiano, massimo 3 frasi, tono professionale."
      : "You are a formal booking assistant. Reply in English, max 3 sentences, professional tone.";
  try {
    const client = new OpenAIResponsesClient(openAiApiKey, 12000);
    const response = await client.create({
      model: openAiModel,
      instructions: systemPrompt,
      input: input.text,
      turnType: "user_input"
    });

    if (!response.outputText.trim()) {
      return input.locale === "it"
        ? "Messaggio ricevuto. Un operatore la ricontattera a breve."
        : "Message received. An operator will contact you shortly.";
    }

    return response.outputText.trim();
  } catch {
    return input.locale === "it"
      ? "Messaggio ricevuto. Un operatore la ricontattera a breve."
      : "Message received. An operator will contact you shortly.";
  }
}

async function processIncomingText(input: {
  text: string;
  locale: SupportedLocale;
  source: "telegram" | "whatsapp";
  chatId?: number;
  senderPhoneE164?: string;
  routeContext?: BotRoutingContext | null;
}) {
  const routeContext = input.routeContext ?? getLegacyRouteContext();
  const normalized = input.text.trim().toLowerCase();

  if (normalized.startsWith("/book ")) {
    const parts = input.text.trim().split(/\s+/);
    const serviceId = parts[1];
    const startAtIso = parts[2];
    const rawPhone = parts[3];
    const phone =
      rawPhone?.startsWith("+") === true ? rawPhone : input.source === "whatsapp" ? input.senderPhoneE164 : undefined;
    const masterId = rawPhone?.startsWith("+") ? parts[4] : parts[3];
    const name = (rawPhone?.startsWith("+") ? parts.slice(5) : parts.slice(4)).join(" ").trim();

    if (!serviceId || !startAtIso || !phone) {
      return input.locale === "it"
        ? "Formato: /book <serviceId> <startAtISO> <phoneE164> [masterId] [nome]"
        : "Format: /book <serviceId> <startAtISO> <phoneE164> [masterId] [name]";
    }

    try {
      await createBookingFromBot({
        serviceId,
        startAtIso,
        phone,
        locale: input.locale,
        source: input.source,
        chatId: input.chatId,
        masterId,
        clientName: name || undefined,
        routeContext
      });
      return input.locale === "it"
        ? "Richiesta prenotazione ricevuta. Attendi conferma dall'amministratore."
        : "Booking request received. Please wait for admin confirmation.";
    } catch {
      return input.locale === "it"
        ? "Impossibile creare la prenotazione. Verifica i dati e riprova."
        : "Unable to create booking. Please check data and try again.";
    }
  }

  if (normalized.startsWith("/cancel ")) {
    const parts = input.text.trim().split(/\s+/);
    const bookingId = parts[1];
    const rawPhone = parts[2];
    const phone = rawPhone ?? (input.source === "whatsapp" ? input.senderPhoneE164 : undefined);
    if (!bookingId || !phone) {
      return input.locale === "it"
        ? "Formato: /cancel <bookingId> <phoneE164>"
        : "Format: /cancel <bookingId> <phoneE164>";
    }

    try {
      await cancelBookingFromBot({ bookingId, phone, routeContext });
      return input.locale === "it"
        ? "Prenotazione annullata."
        : "Booking cancelled.";
    } catch {
      return input.locale === "it"
        ? "Impossibile annullare la prenotazione. Verifica codice e telefono."
        : "Unable to cancel booking. Please verify booking code and phone.";
    }
  }

  const staticReply = await buildStaticReply(input.text, input.locale, routeContext);
  return staticReply ?? (await generateAiReply({ text: input.text, locale: input.locale }));
}

async function checkApiHealth() {
  if (!apiUrl) {
    return "disabled" as const;
  }
  try {
    const response = await fetch(`${apiUrl}/api/v1/health`, {
      headers: internalApiSecret ? { "x-internal-secret": internalApiSecret } : undefined
    });
    return response.ok ? ("ok" as const) : ("error" as const);
  } catch {
    return "error" as const;
  }
}

async function checkRedisHealth() {
  if (!redis) {
    return "disabled" as const;
  }
  try {
    if (redis.status === "wait") {
      await redis.connect();
    }
    const pong = await redis.ping();
    return pong === "PONG" ? ("ok" as const) : ("error" as const);
  } catch {
    return "error" as const;
  }
}

async function checkWhatsAppTokenHealth() {
  if (!waPhoneNumberId && waAccessTokenByPhone.size === 0) {
    return {
      status: "disabled" as const,
      details: [] as Array<{ phoneNumberId: string; status: "ok" | "error"; httpStatus?: number }>
    };
  }
  const now = Date.now();
  if (waTokenHealthCache && now - waTokenHealthCache.checkedAtMs < waTokenHealthCacheTtlMs) {
    return {
      status: waTokenHealthCache.status,
      details: waTokenHealthCache.details
    };
  }

  const phoneIds = Array.from(
    new Set([waPhoneNumberId, ...waAccessTokenByPhone.keys()].map((item) => item.trim()).filter(Boolean))
  );
  const details: Array<{ phoneNumberId: string; status: "ok" | "error"; httpStatus?: number }> = [];
  let hasError = false;

  for (const phoneNumberId of phoneIds) {
    const token = resolveOutgoingWhatsAppAccessToken(phoneNumberId);
    if (!token) {
      details.push({ phoneNumberId, status: "error" });
      hasError = true;
      continue;
    }
    try {
      const response = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}?fields=id`, {
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`
        }
      });
      if (!response.ok) {
        hasError = true;
        details.push({ phoneNumberId, status: "error", httpStatus: response.status });
      } else {
        details.push({ phoneNumberId, status: "ok", httpStatus: response.status });
      }
    } catch {
      hasError = true;
      details.push({ phoneNumberId, status: "error" });
    }
  }

  const previousStatus = waTokenHealthCache?.status ?? null;
  waTokenHealthCache = {
    checkedAtMs: now,
    status: hasError ? "error" : "ok",
    details
  };
  if (hasError && previousStatus !== "error") {
    await emitOpsAlert({
      event: "wa_token_health_error",
      severity: "critical",
      context: {
        details: details
          .filter((item) => item.status === "error")
          .map((item) => ({
            phoneNumberId: item.phoneNumberId,
            httpStatus: item.httpStatus ?? null
          }))
      }
    });
  }
  return {
    status: waTokenHealthCache.status,
    details
  };
}

function renderPrometheusMetrics() {
  const startedAtMs = Date.parse(runtimeStats.startedAt);
  const uptimeSeconds = Number.isFinite(startedAtMs)
    ? Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000))
    : 0;
  const lines = [
    "# HELP bot_uptime_seconds Bot process uptime in seconds.",
    "# TYPE bot_uptime_seconds gauge",
    `bot_uptime_seconds ${uptimeSeconds}`,
    "# HELP bot_inbound_messages_total Total inbound messages processed by bot runtime.",
    "# TYPE bot_inbound_messages_total counter",
    `bot_inbound_messages_total ${runtimeStats.inboundMessages}`,
    "# HELP bot_ai_handled_total Total inbound messages handled by AI orchestration.",
    "# TYPE bot_ai_handled_total counter",
    `bot_ai_handled_total ${runtimeStats.aiHandled}`,
    "# HELP bot_deterministic_handled_total Total inbound messages handled by deterministic flow.",
    "# TYPE bot_deterministic_handled_total counter",
    `bot_deterministic_handled_total ${runtimeStats.deterministicHandled}`,
    "# HELP bot_admin_digest_handled_total Total admin digest commands handled by bot runtime.",
    "# TYPE bot_admin_digest_handled_total counter",
    `bot_admin_digest_handled_total ${runtimeStats.adminDigestHandled}`,
    "# HELP bot_admin_digest_errors_total Total admin digest command errors in bot runtime.",
    "# TYPE bot_admin_digest_errors_total counter",
    `bot_admin_digest_errors_total ${runtimeStats.adminDigestErrors}`,
    "# HELP bot_handoff_escalations_total Total handoff escalations triggered by bot runtime.",
    "# TYPE bot_handoff_escalations_total counter",
    `bot_handoff_escalations_total ${runtimeStats.handoffEscalations}`,
    "# HELP bot_processing_errors_total Total message-processing errors in bot runtime.",
    "# TYPE bot_processing_errors_total counter",
    `bot_processing_errors_total ${runtimeStats.processingErrors}`,
    "# HELP bot_unknown_intent_total Total messages resolved as unknown intent.",
    "# TYPE bot_unknown_intent_total counter",
    `bot_unknown_intent_total ${runtimeStats.unknownIntentHandled}`
  ];
  return `${lines.join("\n")}\n`;
}

app.get("/health", (c) => {
  return c.json({
    data: {
      status: "ok",
      service: "bot",
      build: buildInfo,
      stats: runtimeStats
    }
  });
});

app.get("/metrics", (c) => {
  return c.text(renderPrometheusMetrics(), 200, {
    "content-type": "text/plain; version=0.0.4; charset=utf-8"
  });
});

app.get("/ready", async (c) => {
  const [apiStatus, redisStatus, waTokenHealth] = await Promise.all([
    checkApiHealth(),
    checkRedisHealth(),
    checkWhatsAppTokenHealth()
  ]);
  const waStatus = waTokenHealth.status === "disabled" ? "disabled" : waTokenHealth.status;
  const ready =
    apiStatus !== "error" &&
    redisStatus !== "error" &&
    (!waTokenHealthRequired || waStatus !== "error");

  return c.json(
    {
      data: {
        status: ready ? "ready" : "not_ready",
        service: "bot",
        checks: {
          redis: redisStatus,
          api: apiStatus,
          waToken: waStatus
        },
        waTokenDetails: waTokenHealth.details
          .filter((item) => item.status === "error")
          .map((item) => ({
            phoneNumberId: item.phoneNumberId,
            status: item.status,
            httpStatus: item.httpStatus ?? null
          }))
      }
    },
    ready ? 200 : 503
  );
});

app.get("/internal/health/wa-token", async (c) => {
  if (!internalApiSecret) {
    return c.json({ error: { code: "CONFIG_ERROR", message: "INTERNAL_API_SECRET is not configured" } }, 503);
  }
  const providedSecret = c.req.header("x-internal-secret");
  if (providedSecret !== internalApiSecret) {
    return c.json({ error: { code: "AUTH_FORBIDDEN", message: "Invalid internal secret" } }, 403);
  }
  const health = await checkWhatsAppTokenHealth();
  return c.json({
    data: {
      status: health.status,
      required: waTokenHealthRequired,
      details: health.details
    }
  });
});

app.post("/internal/smoke/ai-failover", async (c) => {
  if (!internalApiSecret) {
    return c.json({ error: { code: "CONFIG_ERROR", message: "INTERNAL_API_SECRET is not configured" } }, 503);
  }
  const providedSecret = c.req.header("x-internal-secret");
  if (providedSecret !== internalApiSecret) {
    return c.json({ error: { code: "AUTH_FORBIDDEN", message: "Invalid internal secret" } }, 403);
  }

  const payload = await c.req.json().catch(() => null);
  const text = typeof payload?.text === "string" ? payload.text : "";
  const locale = payload?.locale === "en" ? "en" : "it";
  if (!text.trim()) {
    return c.json({ error: { code: "VALIDATION_ERROR", message: "text is required" } }, 400);
  }

  const parsed = detectTransportFallbackIntent(text, locale);
  return c.json({
    data: {
      ok: true,
      input: { text, locale },
      fallbackDetected: Boolean(parsed),
      parsed:
        parsed == null
          ? null
          : {
              intent: parsed.intent,
              confidence: parsed.confidence,
              dateText: parsed.dateText ?? null,
              timeText: parsed.timeText ?? null
            }
    }
  });
});

app.post("/webhooks/telegram", async (c) => {
  if (telegramWebhookSecret) {
    const secret = c.req.header("x-telegram-bot-api-secret-token");
    if (secret !== telegramWebhookSecret) {
      return c.json({ error: { code: "AUTH_FORBIDDEN", message: "Invalid telegram secret" } }, 403);
    }
  }

  try {
    const payload = await c.req.json<TelegramUpdate>();
    const chatId = payload.message?.chat?.id;
    const text = payload.message?.text;

    if (!chatId || !text) {
      return c.json({ data: { accepted: true, reason: "no_message" } });
    }

    const locale = resolveLocaleFromTelegram(payload);
    const replyText = await processIncomingText({
      text,
      locale,
      source: "telegram",
      chatId
    });
    const result = await sendTelegramMessage({ chatId, text: replyText });

    return c.json({
      data: {
        accepted: true,
        updateId: payload.update_id ?? null,
        sent: result.sent
      }
    });
  } catch (error) {
    await captureException({
      service: "bot",
      error,
      context: { route: "/webhooks/telegram" }
    });
    return c.json({ error: { code: "INTERNAL_ERROR", message: "Internal error" } }, 500);
  }
});

app.get("/webhooks/whatsapp", (c) => {
  const mode = c.req.query("hub.mode");
  const token = c.req.query("hub.verify_token");
  const challenge = c.req.query("hub.challenge");

  if (mode === "subscribe" && challenge && token && waVerifyToken && token === waVerifyToken) {
    console.info("[bot] whatsapp verify challenge accepted");
    return c.text(challenge, 200);
  }

  console.warn("[bot] whatsapp verify challenge rejected");
  return c.json({ error: { code: "AUTH_FORBIDDEN", message: "Invalid WhatsApp verify token" } }, 403);
});

app.post("/webhooks/whatsapp", async (c) => {
  const rawBody = await c.req.text();
  try {
    assertWhatsAppSignature(c.req.header("x-hub-signature-256"), rawBody);
    const payload = JSON.parse(rawBody) as unknown;
    const inbound = extractWhatsAppInbound(payload);
    console.info("[bot] whatsapp webhook accepted", { inboundCount: inbound.length });

    for (const item of inbound) {
      let routeContext: BotRoutingContext | null = null;
      let sessionLockToken: string | null = null;
      try {
        const notDuplicate = await dedupInboundMessage(item.messageId);
        if (!notDuplicate) {
          console.info("[bot] whatsapp duplicate ignored", {
            messageId: item.messageId,
            from: maskPhone(item.from)
          });
          continue;
        }
        bumpRuntimeCounter("inboundMessages");
        await markWhatsAppMessageAsRead({
          incomingPhoneNumberId: item.phoneNumberId,
          messageId: item.messageId
        });

      routeContext = await resolveWhatsAppRouteContext(item);
      if (!routeContext || (!routeContext.tenantSlug && !routeContext.tenantId)) {
        console.warn("[bot] whatsapp routing context missing", {
          messageId: item.messageId,
          from: maskPhone(item.from),
          phoneNumberId: item.phoneNumberId ?? null
        });
        await emitOpsAlert({
          event: "whatsapp_routing_context_missing",
          severity: "critical",
          context: {
            messageId: item.messageId,
            from: maskPhone(item.from),
            phoneNumberId: item.phoneNumberId ?? null
          }
        });
        continue;
      }
      await touchWhatsAppWindowFromInbound({
        routeContext,
        senderPhoneNumberId: item.phoneNumberId,
        recipientE164: item.from,
        locale: item.locale
      });
      const lock = await acquireSessionProcessingLock({
        phone: item.from,
        routeContext
      });
      if (!lock.acquired) {
        await sendWhatsAppMessage({
          to: item.from,
          text:
            item.locale === "it"
              ? "Sto ancora elaborando il messaggio precedente. Riprova tra pochi secondi."
              : "I am still processing your previous message. Please retry in a few seconds.",
          routeContext
        });
        console.warn("[bot] session lock not acquired", {
          messageId: item.messageId,
          from: maskPhone(item.from),
          tenantKey: getTenantQuotaKey(routeContext)
        });
        continue;
      }
      sessionLockToken = lock.token;

      const replayResult = await replayPendingOutboundIfNeeded(item.from, routeContext);
      if (replayResult.replayed) {
        console.info("[bot] outbound replay attempted", {
          messageId: item.messageId,
          from: maskPhone(item.from),
          delivered: replayResult.delivered
        });
      }

      const existingSession = await loadWhatsAppSession(item.from, routeContext);
      const emojiReplyId = mapConfirmEmojiReplyId(existingSession, item.text);
      const effectiveReplyId = item.replyId ?? emojiReplyId;
      const effectiveText = emojiReplyId ? undefined : item.text;
      await recordEnterpriseUsageEvent({
        routeContext,
        metric: "messages_inbound",
        dedupeKey: `${item.messageId}:inbound`,
        context: { source: "whatsapp_webhook" }
      });
      const localeResolution = resolveConversationLocale({
        text: effectiveText ?? item.text,
        rawInboundLocale: item.locale,
        sessionLocale: existingSession?.locale,
        tenantDefaultLocale: "it"
      });
      const effectiveLocale = localeResolution.resolvedLocale;

      console.info("[bot] whatsapp inbound message", {
        messageId: item.messageId,
        from: maskPhone(item.from),
        messageType: item.messageType,
        hasText: Boolean(item.text),
        hasReplyId: Boolean(effectiveReplyId),
        locale: effectiveLocale,
        localeReason: localeResolution.localeReason
      });

        if (!effectiveText && !effectiveReplyId && item.messageType !== "text") {
        await sendWhatsAppButtons({
          to: item.from,
          bodyText:
            effectiveLocale === "it"
              ? "Al momento posso gestire messaggi testuali. Scegli un'azione:"
              : "I can process text messages right now. Choose an action:",
          choices: [
            {
              id: "intent:new",
              title: effectiveLocale === "it" ? "Nuova prenotazione" : "New booking"
            },
            {
              id: "intent:cancel",
              title: effectiveLocale === "it" ? "Annulla prenotazione" : "Cancel booking"
            },
            {
              id: "flow:restart",
              title: effectiveLocale === "it" ? "Inizio" : "Start over"
            }
          ],
          routeContext
        });
        console.info("[bot] non-text inbound handled", {
          messageId: item.messageId,
          from: maskPhone(item.from),
          messageType: item.messageType
        });
        bumpRuntimeCounter("nonTextHandled");
        continue;
      }

      const rateLimit = await checkInboundRateLimit({
        phone: item.from,
        windowSeconds: rateLimitWindowSeconds,
        maxMessages: rateLimitMaxMessages,
        routeContext
      });
      if (!rateLimit.allowed) {
        await sendWhatsAppMessage({
          to: item.from,
          text:
            effectiveLocale === "it"
              ? "Hai inviato troppi messaggi in poco tempo. Riprova tra circa un minuto."
              : "You sent too many messages in a short time. Please try again in about a minute.",
          routeContext
        });
        console.warn("[bot] whatsapp rate limit exceeded", {
          messageId: item.messageId,
          from: maskPhone(item.from),
          used: rateLimit.used,
          maxMessages: rateLimitMaxMessages,
          windowSeconds: rateLimitWindowSeconds
        });
        if (rateLimit.used === rateLimitMaxMessages + 1) {
          await emitOpsAlert({
            event: "inbound_rate_limit_exceeded",
            severity: "warning",
            context: {
              from: maskPhone(item.from),
              used: rateLimit.used,
              maxMessages: rateLimitMaxMessages,
              windowSeconds: rateLimitWindowSeconds,
              messageId: item.messageId
            }
          });
        }
        continue;
      }

      const tenantRateLimit = await checkTenantInboundRateLimit({
        tenantKey: getTenantQuotaKey(routeContext),
        windowSeconds: tenantRateLimitWindowSeconds,
        maxMessages: tenantRateLimitMaxMessages
      });
      if (!tenantRateLimit.allowed) {
        await sendWhatsAppMessage({
          to: item.from,
          text:
            effectiveLocale === "it"
              ? "C'e molto traffico in questo momento. Riprova tra poco."
              : "There is high traffic right now. Please try again shortly.",
          routeContext
        });
        console.warn("[bot] tenant rate limit exceeded", {
          messageId: item.messageId,
          tenantKey: getTenantQuotaKey(routeContext),
          from: maskPhone(item.from),
          used: tenantRateLimit.used,
          maxMessages: tenantRateLimitMaxMessages,
          windowSeconds: tenantRateLimitWindowSeconds
        });
        if (tenantRateLimit.used === tenantRateLimitMaxMessages + 1) {
          await emitOpsAlert({
            event: "tenant_inbound_rate_limit_exceeded",
            severity: "warning",
            context: {
              tenantKey: getTenantQuotaKey(routeContext),
              used: tenantRateLimit.used,
              maxMessages: tenantRateLimitMaxMessages,
              windowSeconds: tenantRateLimitWindowSeconds
            }
          });
        }
        continue;
      }

      if (effectiveReplyId?.startsWith("cta:")) {
        const handledCta = await handleWhatsAppCtaReply({
          from: item.from,
          replyId: effectiveReplyId,
          locale: effectiveLocale,
          routeContext
        });
        if (handledCta) {
          bumpRuntimeCounter("ctaHandled");
          continue;
        }
      }

      if (!effectiveReplyId && effectiveText) {
        const handledRejectReason = await handlePendingAdminRejectReason({
          from: item.from,
          text: effectiveText,
          locale: effectiveLocale,
          routeContext
        });
        if (handledRejectReason) {
          bumpRuntimeCounter("ctaHandled");
          continue;
        }
      }

      const handledAdminDigest = await handleAdminDigestCommand({
        from: item.from,
        text: effectiveText,
        replyId: effectiveReplyId,
        locale: effectiveLocale,
        routeContext
      });
      if (handledAdminDigest) {
        bumpRuntimeCounter("ctaHandled");
        continue;
      }

      const resetResult = await applyConversationResetPolicy(
        {
          session: existingSession,
          locale: effectiveLocale,
          text: effectiveText,
          replyId: effectiveReplyId,
          now: new Date(),
          idleResetMinutes: sessionIdleResetMinutes
        },
        {
          fetchServices: async (locale) => fetchServicesForConversation(locale, routeContext),
          fetchMasters: async (locale, serviceId) =>
            fetchMastersForConversation(locale, serviceId, routeContext)
        }
      );
      await saveWhatsAppSession(item.from, resetResult.session, routeContext);
      console.info("[bot] whatsapp reset policy", {
        messageId: item.messageId,
        from: maskPhone(item.from),
        resetDecision: resetResult.decision,
        resetReason: resetResult.reason ?? null,
        previousState: existingSession?.state ?? null,
        previousIntent: existingSession?.intent ?? null,
        previousMode: existingSession?.currentMode ?? null,
        hadPreviousResponseId: Boolean(existingSession?.lastOpenaiResponseId),
        idleMinutes: resetResult.idleMinutes ?? null,
        detectedIntent: resetResult.detectedIntent,
        hasReplyId: Boolean(effectiveReplyId),
        localeReason: localeResolution.localeReason,
        resetApplied: resetResult.shouldResetSession,
        rerouteAfterReset: resetResult.shouldRerouteCurrentMessage,
        currentStepContinuationMatched: resetResult.currentStepContinuationMatched,
        continuationClassifier: resetResult.continuationClassifier,
        matchedCandidateCount: resetResult.matchedCandidateCount,
        matchedCandidateType: resetResult.matchedCandidateType
      });
      if (
        resetResult.reason === "idle_timeout" &&
        resetResult.shouldRerouteCurrentMessage &&
        effectiveText &&
        !effectiveReplyId
      ) {
        await sendWhatsAppMessage({
          to: item.from,
          text:
            effectiveLocale === "it"
              ? "Sessione scaduta per inattivita. Ripartiamo da qui."
              : "Your session expired after inactivity. Let us continue from here.",
          routeContext
        });
      }

      const conversationDeps = {
        dedupInboundMessage,
        loadSession: (phone: string) => loadWhatsAppSession(phone, routeContext),
        saveSession: (phone: string, session: WhatsAppConversationSession) =>
          saveWhatsAppSession(phone, session, routeContext),
        clearSession: (phone: string) => clearWhatsAppSession(phone, routeContext),
        sendText: async (to: string, text: string) => {
          await sendWhatsAppMessage({ to, text, routeContext });
        },
        sendList: async (to: string, bodyText: string, buttonText: string, choices: Array<{ id: string; title: string; description?: string }>) => {
          await sendWhatsAppList({ to, bodyText, buttonText, choices, routeContext });
        },
        sendButtons: async (to: string, bodyText: string, choices: Array<{ id: string; title: string; description?: string }>) => {
          await sendWhatsAppButtons({ to, bodyText, choices, routeContext });
        },
        createFlowCtaAction: (input: {
          action: "flow_confirm_booking" | "flow_confirm_cancel";
          bookingId: string;
          phone: string;
          ttlMinutes?: number;
        }) => {
          const token = buildBookingActionTokenForBot({
            action: input.action,
            bookingId: input.bookingId,
            phoneE164: input.phone,
            ttlMinutes: input.ttlMinutes
          });
          return token ?? undefined;
        },
        fetchServices: async (locale: SupportedLocale) =>
          fetchServicesForConversation(locale, routeContext),
        fetchMasters: async (locale: SupportedLocale, serviceId?: string) =>
          fetchMastersForConversation(locale, serviceId, routeContext),
        fetchSlots: async (input: {
          serviceId: string;
          masterId?: string;
          date: string;
          locale: SupportedLocale;
        }) => fetchSlotsFromApi({ ...input, routeContext }),
        listBookingsByPhone: (input: { phone: string; limit?: number }) =>
          listBookingsByPhoneFromBot({ ...input, routeContext }),
        createBooking: async (input: {
          serviceId: string;
          masterId?: string;
          startAtIso: string;
          phone: string;
          locale: SupportedLocale;
          clientName?: string;
        }) =>
          createBookingFromBot({
            serviceId: input.serviceId,
            startAtIso: input.startAtIso,
            phone: input.phone,
            locale: input.locale,
            source: "whatsapp",
            masterId: input.masterId,
            clientName: input.clientName,
            routeContext
          }),
        cancelBooking: (input: { bookingId: string; phone: string }) =>
          cancelBookingFromBot({ ...input, routeContext }),
        rescheduleBooking: (input: {
          bookingId: string;
          phone: string;
          serviceId: string;
          masterId?: string;
          startAtIso: string;
          locale: SupportedLocale;
        }) => rescheduleBookingFromBot({ ...input, routeContext }),
        getTenantTimezone: () => getTenantTimezoneForConversation(routeContext),
        getTenantConfig: () => getTenantBotConfig(routeContext),
        notifyAdminHandoff: (input: { phone: string; summary: string; locale: SupportedLocale }) =>
          notifyAdminWhatsAppHandoff({ ...input, routeContext }),
        getLateCancelPolicy: async () => {
          const config = await getTenantBotConfig(routeContext);
          return {
            warnHours: parseNonNegativeNumber(config.lateCancelWarnHours, botLateCancelWarnHours),
            blockHours: parseNonNegativeNumber(config.lateCancelBlockHours, botLateCancelBlockHours)
          };
        }
      };

      let flowResult = { handled: false };
      let aiHandledThisMessage = false;
      const shouldAttemptAiFromChooseIntent =
        resetResult.decision === "continue_current_flow" &&
        resetResult.session.state === "choose_intent" &&
        !resetResult.session.intent &&
        !item.replyId &&
        Boolean(item.text) &&
        !isStructuredControlMessage(item.text ?? "");

      if (
        !resetResult.shouldFallbackToMenuImmediately &&
        !effectiveReplyId &&
        effectiveText &&
        !isStructuredControlMessage(effectiveText) &&
        (resetResult.shouldRerouteCurrentMessage || shouldAttemptAiFromChooseIntent)
      ) {
        const aiEnabledForTenant = openAiResponsesEnabled && isAiCanaryEnabledForTenant(routeContext);
        if (!aiEnabledForTenant) {
          console.info("[bot] ai canary disabled for tenant", {
            messageId: item.messageId,
            tenantSlug: routeContext.tenantSlug ?? null,
            tenantId: routeContext.tenantId ?? null,
            salonId: routeContext.salonId ?? null
          });
        }
        console.info("[bot] ai route decision", {
          messageId: item.messageId,
          from: maskPhone(item.from),
          shouldRerouteCurrentMessage: resetResult.shouldRerouteCurrentMessage,
          shouldAttemptAiFromChooseIntent,
          state: resetResult.session.state,
          intent: resetResult.session.intent ?? null
        });
        const aiResult = await processAiWhatsAppMessage(
          {
            from: item.from,
            text: effectiveText,
            locale: effectiveLocale,
            openAiApiKey,
            globalModel: openAiModel,
            globalEnabled: aiEnabledForTenant,
            tenantQuotaKey: getTenantQuotaKey(routeContext),
            aiMaxCallsPerSession: openAiMaxCallsPerSession,
            aiMaxCallsPerDay: openAiMaxCallsPerDay,
            aiFailureHandoffThreshold,
            unknownTurnHandoffThreshold
          },
          {
            loadSession: (phone) => loadWhatsAppSession(phone, routeContext),
            saveSession: (phone, session) => saveWhatsAppSession(phone, session, routeContext),
            clearSession: (phone) => clearWhatsAppSession(phone, routeContext),
            sendText: async (to, text) => {
              await sendWhatsAppMessage({ to, text, routeContext });
            },
            sendList: async (to, bodyText, buttonText, choices) => {
              await sendWhatsAppList({ to, bodyText, buttonText, choices, routeContext });
            },
            sendButtons: async (to, bodyText, choices) => {
              await sendWhatsAppButtons({ to, bodyText, choices, routeContext });
            },
            fetchServices: (locale) => fetchServicesForConversation(locale, routeContext),
            fetchMasters: (locale, serviceId) =>
              fetchMastersForConversation(locale, serviceId, routeContext),
            fetchSlots: async (payload) => fetchSlotsFromApi({ ...payload, routeContext }),
            listBookingsByPhone: (input) => listBookingsByPhoneFromBot({ ...input, routeContext }),
            createBooking: async (payload) =>
              createBookingFromBot({
                serviceId: payload.serviceId,
                startAtIso: payload.startAtIso,
                phone: payload.phone,
                locale: payload.locale,
                source: "whatsapp",
                masterId: payload.masterId,
                clientName: payload.clientName,
                routeContext
              }),
            cancelBooking: (input) => cancelBookingFromBot({ ...input, routeContext }),
            rescheduleBooking: (input) => rescheduleBookingFromBot({ ...input, routeContext }),
            getTenantConfig: () => getTenantBotConfig(routeContext),
            notifyAdminHandoff: (input) => notifyAdminWhatsAppHandoff({ ...input, routeContext }),
            emitOpsAlert,
            consumeAiDailyQuota
          }
        );
        flowResult = aiResult;
        aiHandledThisMessage = aiResult.handled;
      }

      if (!flowResult.handled) {
        flowResult = await processWhatsAppConversation(
          {
            messageId: item.messageId,
            from: item.from,
            locale: effectiveLocale,
            text:
              !effectiveReplyId && resetResult.decision === "hard_reset_to_new_intent"
                ? toDeterministicIntentToken(resetResult.detectedIntent) ?? effectiveText
                : effectiveText,
            replyId:
              !effectiveReplyId && resetResult.decision === "hard_reset_to_new_intent"
                ? toDeterministicIntentToken(resetResult.detectedIntent)
                : effectiveReplyId
          },
          conversationDeps,
          { skipDedup: true }
        );
      }

      console.info("[bot] whatsapp flow result", {
        messageId: item.messageId,
        from: maskPhone(item.from),
        handled: flowResult.handled
      });
      if (flowResult.handled) {
        if (aiHandledThisMessage) {
          await recordEnterpriseUsageEvent({
            routeContext,
            metric: "ai_calls",
            dedupeKey: `${item.messageId}:ai`,
            context: { source: "whatsapp_webhook" }
          });
          bumpRuntimeCounter("aiHandled");
          try {
            const aiSession = await loadWhatsAppSession(item.from, routeContext);
            if (
              aiSession?.complaintDetectedAt &&
              aiSession.lastUserMessageAt &&
              aiSession.complaintDetectedAt === aiSession.lastUserMessageAt
            ) {
              bumpRuntimeCounter("complaintSignalsDetected");
            }
            if (aiSession?.lastResolvedIntent === "unknown") {
              bumpRuntimeCounter("unknownIntentHandled");
              const unknownAlert = await recordTenantUnknownIntentAndAlert({
                tenantKey: getTenantQuotaKey(routeContext),
                windowSeconds: unknownTenantAlertWindowSeconds,
                threshold: unknownTenantAlertThreshold
              });
              if (unknownAlert.alerted) {
                await emitOpsAlert({
                  event: "tenant_unknown_intent_spike",
                  severity: "warning",
                  context: {
                    tenantKey: getTenantQuotaKey(routeContext),
                    used: unknownAlert.used,
                    threshold: unknownTenantAlertThreshold,
                    windowSeconds: unknownTenantAlertWindowSeconds
                  }
                });
              }
            }
            if (
              aiSession?.currentMode === "human_handoff" ||
              aiSession?.handoffStatus === "active" ||
              aiSession?.handoffStatus === "pending"
            ) {
              bumpRuntimeCounter("handoffEscalations");
            }
            if (
              aiSession?.handoffReason === "complaint" &&
              aiSession.handoffAt &&
              aiSession.complaintDetectedAt &&
              aiSession.complaintLatencyRecordedAt !== aiSession.handoffAt
            ) {
              const detectedAtTs = Date.parse(aiSession.complaintDetectedAt);
              const handoffAtTs = Date.parse(aiSession.handoffAt);
              if (Number.isFinite(detectedAtTs) && Number.isFinite(handoffAtTs)) {
                bumpRuntimeCounter("complaintHandoffs");
                recordComplaintToHandoffLatency(handoffAtTs - detectedAtTs);
                aiSession.complaintLatencyRecordedAt = aiSession.handoffAt;
                await saveWhatsAppSession(item.from, aiSession, routeContext);
              }
            }
          } catch (error) {
            console.warn("[bot] runtime ai stats probe failed", {
              messageId: item.messageId,
              from: maskPhone(item.from),
              error: toLogError(error)
            });
          }
        } else {
          bumpRuntimeCounter("deterministicHandled");
        }
      }

        if (!flowResult.handled && effectiveText) {
          const replyText = await processIncomingText({
            text: effectiveText,
            locale: effectiveLocale,
            source: "whatsapp",
            senderPhoneE164: item.from,
            routeContext
          });
          await sendWhatsAppMessage({ to: item.from, text: replyText, routeContext });
          console.info("[bot] whatsapp fallback reply sent", {
            messageId: item.messageId,
            from: maskPhone(item.from)
          });
          bumpRuntimeCounter("fallbackTextHandled");
        }
      } catch (error) {
        bumpRuntimeCounter("processingErrors");
        console.error("[bot] whatsapp message processing failed", {
          messageId: item.messageId,
          from: maskPhone(item.from),
          message: toLogError(error)
        });
        await emitOpsAlert({
          event: "whatsapp_message_processing_failed",
          severity: "warning",
          context: {
            messageId: item.messageId,
            from: maskPhone(item.from),
            message: toLogError(error)
          }
        });
        await captureException({
          service: "bot",
          error,
          context: { route: "/webhooks/whatsapp", messageId: item.messageId }
        });
        try {
          await sendWhatsAppMessage({
            to: item.from,
            text:
              item.locale === "it"
                ? "Servizio temporaneamente non disponibile. Riprova tra pochi secondi."
                : "Service is temporarily unavailable. Please retry in a few seconds.",
            routeContext
          });
        } catch (fallbackError) {
          console.error("[bot] fallback whatsapp send failed", {
            messageId: item.messageId,
            from: maskPhone(item.from),
            error: toLogError(fallbackError)
          });
        }
        continue;
      } finally {
        if (sessionLockToken && routeContext) {
          try {
            await releaseSessionProcessingLock({
              phone: item.from,
              routeContext,
              token: sessionLockToken
            });
          } catch (releaseError) {
            console.warn("[bot] session lock release failed", {
              messageId: item.messageId,
              from: maskPhone(item.from),
              error: toLogError(releaseError)
            });
          }
        }
      }
    }

    return c.json({
      data: {
        accepted: true,
        processed: inbound.length
      }
    });
  } catch (error) {
    console.error("[bot] whatsapp webhook processing failed", {
      message: toLogError(error)
    });
    await emitOpsAlert({
      event: "whatsapp_webhook_processing_failed",
      severity: "critical",
      context: {
        message: toLogError(error)
      }
    });
    await captureException({
      service: "bot",
      error,
      context: { route: "/webhooks/whatsapp" }
    });
    return c.json({ error: { code: "INTERNAL_ERROR", message: "Internal error" } }, 500);
  }
});

const port = Number(process.env.PORT ?? 3002);

process.on("unhandledRejection", (reason) => {
  console.error("[bot] unhandled rejection", {
    message: toLogError(reason)
  });
});

process.on("uncaughtException", (error) => {
  console.error("[bot] uncaught exception", {
    message: toLogError(error)
  });
});

const server = serve({
  fetch: app.fetch,
  port
});

async function shutdown(signal: "SIGTERM" | "SIGINT") {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  console.info("[bot] shutdown started", {
    signal,
    inflightRequests
  });
  server.close();
  await waitForInflightRequests(15_000);
  if (redis) {
    try {
      await redis.quit();
    } catch (error) {
      console.warn("[bot] redis quit failed", {
        error: toLogError(error)
      });
    }
  }
  console.info("[bot] shutdown completed", {
    signal,
    inflightRequests
  });
  process.exit(0);
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

console.log(`[bot] listening on :${port}`);
