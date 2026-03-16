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
  processWhatsAppConversation,
  type WhatsAppConversationSession
} from "./whatsapp-conversation";
import { detectTransportFallbackIntent, processAiWhatsAppMessage } from "./ai-orchestrator";
import { OpenAIResponsesClient } from "./openai-responses-client";
import { applyConversationResetPolicy, toDeterministicIntentToken } from "./conversation-reset-policy";
import { resolveConversationLocale } from "./conversation-locale";

const app = new Hono();
const telegramWebhookSecret = process.env.TG_WEBHOOK_SECRET_TOKEN ?? "";
const telegramBotToken = process.env.TG_BOT_TOKEN ?? "";
const waPhoneNumberId = process.env.WA_PHONE_NUMBER_ID ?? "";
const waAccessToken = process.env.WA_ACCESS_TOKEN ?? "";
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
const rateLimitWindowSeconds = Math.max(10, Number.parseInt(process.env.RATE_LIMIT_WINDOW_SECONDS ?? "60", 10) || 60);
const rateLimitMaxMessages = Math.max(1, Number.parseInt(process.env.RATE_LIMIT_MAX_MESSAGES ?? "20", 10) || 20);
const sessionIdleResetMinutes = Math.max(1, Number.parseInt(process.env.SESSION_IDLE_RESET_MINUTES ?? "45", 10) || 45);
const opsAlertWebhookUrl = process.env.OPS_ALERT_WEBHOOK_URL ?? "";
const opsAlertWebhookToken = process.env.OPS_ALERT_WEBHOOK_TOKEN ?? "";
const apiUrl = process.env.API_URL ?? "";
const internalApiSecret = process.env.INTERNAL_API_SECRET ?? "";
const botTenantSlug = process.env.BOT_TENANT_SLUG ?? "";
const botTenantId = process.env.BOT_TENANT_ID ?? "";
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
  text?: string;
  replyId?: string;
  locale: SupportedLocale;
};

type WhatsAppChoice = {
  id: string;
  title: string;
  description?: string;
};

type OpsAlertSeverity = "warning" | "critical";

function maskPhone(value: string): string {
  const raw = value.trim();
  if (!raw) {
    return raw;
  }
  const normalized = raw.replace(/\s+/g, "");
  if (normalized.length <= 4) {
    return "***";
  }
  return `${normalized.slice(0, 3)}***${normalized.slice(-2)}`;
}

function redactLogString(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._-]+\b/gi, "Bearer [redacted]")
    .replace(/\b(EA[A-Za-z0-9]+)\b/g, "[redacted_token]")
    .replace(/\bgh[opus]_[A-Za-z0-9_]+\b/g, "[redacted_token]")
    .replace(/\+?\d[\d\s-]{6,}\d/g, "[redacted_phone]");
}

function toLogError(error: unknown): string {
  if (error instanceof Error) {
    return redactLogString(error.message).slice(0, 300);
  }
  return redactLogString(String(error)).slice(0, 300);
}

function sanitizeAlertContext(context: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (typeof value === "string") {
      out[key] = redactLogString(value).slice(0, 300);
      continue;
    }
    if (
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null ||
      value === undefined
    ) {
      out[key] = value;
      continue;
    }
    try {
      out[key] = redactLogString(JSON.stringify(value)).slice(0, 300);
    } catch {
      out[key] = "[unserializable]";
    }
  }
  return out;
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

async function sendWhatsAppPayload(input: { to: string; payload: Record<string, unknown> }) {
  if (!waPhoneNumberId || !waAccessToken) {
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
    response = await fetch(`https://graph.facebook.com/v21.0/${waPhoneNumberId}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${waAccessToken}`
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

  return { sent: true as const };
}

async function sendWhatsAppMessage(input: { to: string; text: string }) {
  return sendWhatsAppPayload({
    to: input.to,
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
}) {
  const rows = input.choices.slice(0, 10).map((choice) => ({
    id: choice.id,
    title: choice.title.slice(0, 24),
    description: choice.description?.slice(0, 72)
  }));
  return sendWhatsAppPayload({
    to: input.to,
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
  return (
    normalized === "/start" ||
    normalized === "start" ||
    normalized === "menu" ||
    normalized === "back" ||
    normalized === "restart" ||
    normalized === "/cancel" ||
    normalized === "cancel" ||
    normalized === "annulla"
  );
}

function isAiCanaryEnabledForTenant() {
  if (openAiCanaryTenants.length === 0) {
    return true;
  }
  const tenantKeys = [botTenantSlug, botTenantId].filter(Boolean);
  return tenantKeys.some((key) => openAiCanaryTenants.includes(key));
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

async function checkInboundRateLimit(input: { phone: string; windowSeconds: number; maxMessages: number }) {
  if (!redis) {
    return { allowed: true, used: 0 };
  }
  if (redis.status === "wait") {
    await redis.connect();
  }
  const key = `bot:rl:wa:${input.phone}`;
  const used = await redis.incr(key);
  if (used === 1) {
    await redis.expire(key, input.windowSeconds);
  }
  return {
    allowed: used <= input.maxMessages,
    used
  };
}

async function sleepMs(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
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
}) {
  if (!apiUrl || !internalApiSecret || (!botTenantSlug && !botTenantId)) {
    throw new Error("bot_api_config_missing");
  }

  const params = new URLSearchParams({
    serviceId: input.serviceId,
    date: input.date
  });
  if (input.masterId) {
    params.set("masterId", input.masterId);
  }

  const headers: Record<string, string> = {
    "x-internal-secret": internalApiSecret,
    "x-csrf-token": "bot-internal"
  };
  if (botTenantSlug) {
    headers["x-internal-tenant-slug"] = botTenantSlug;
  }
  if (botTenantId) {
    headers["x-internal-tenant-id"] = botTenantId;
  }

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

  return payload.data.items
    .map((item: Record<string, unknown>) => ({
      startAt: String(item.startAt ?? ""),
      displayTime: String(item.displayTime ?? "")
    }))
    .filter((item: { startAt: string; displayTime: string }) => item.startAt && item.displayTime);
}

function buildInternalHeaders() {
  const headers: Record<string, string> = {
    "x-internal-secret": internalApiSecret,
    "x-csrf-token": "bot-internal",
    "content-type": "application/json"
  };
  if (botTenantSlug) {
    headers["x-internal-tenant-slug"] = botTenantSlug;
  }
  if (botTenantId) {
    headers["x-internal-tenant-id"] = botTenantId;
  }
  return headers;
}

function getSessionTenantSegment() {
  if (botTenantSlug) {
    return `slug:${botTenantSlug}`;
  }
  if (botTenantId) {
    return `id:${botTenantId}`;
  }
  return "unknown";
}

function getSessionKey(phone: string) {
  return `wa:session:${getSessionTenantSegment()}:${phone}`;
}

function getInboundDedupKey(messageId: string) {
  return `wa:inbound:${messageId}`;
}

async function loadWhatsAppSession(phone: string): Promise<WhatsAppConversationSession | null> {
  if (!redis) {
    return null;
  }
  if (redis.status === "wait") {
    await redis.connect();
  }
  const raw = await redis.get(getSessionKey(phone));
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as WhatsAppConversationSession;
  } catch {
    return null;
  }
}

async function saveWhatsAppSession(phone: string, session: WhatsAppConversationSession) {
  if (!redis) {
    return;
  }
  if (redis.status === "wait") {
    await redis.connect();
  }
  await redis.set(getSessionKey(phone), JSON.stringify(session), "EX", 60 * 60);
}

async function clearWhatsAppSession(phone: string) {
  if (!redis) {
    return;
  }
  if (redis.status === "wait") {
    await redis.connect();
  }
  await redis.del(getSessionKey(phone));
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

async function fetchServicesForConversation(locale: SupportedLocale) {
  if (!apiUrl || !internalApiSecret || (!botTenantSlug && !botTenantId)) {
    return [] as Array<{ id: string; displayName: string; durationMinutes?: number }>;
  }
  const response = await fetchWithApiRetry(`${apiUrl}/api/v1/public/services?locale=${locale}`, {
    method: "GET",
    headers: buildInternalHeaders()
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(payload?.data?.items)) {
    return [] as Array<{ id: string; displayName: string; durationMinutes?: number }>;
  }
  return payload.data.items.map((item: Record<string, unknown>) => ({
    id: String(item.id ?? ""),
    displayName: String(item.displayName ?? ""),
    durationMinutes:
      typeof item.durationMinutes === "number" ? Number(item.durationMinutes) : undefined
  }));
}

async function fetchMastersForConversation(locale: SupportedLocale, serviceId?: string) {
  if (!apiUrl || !internalApiSecret || (!botTenantSlug && !botTenantId)) {
    return [] as Array<{ id: string; displayName: string }>;
  }
  const params = new URLSearchParams({ locale });
  if (serviceId) {
    params.set("serviceId", serviceId);
  }
  const response = await fetchWithApiRetry(`${apiUrl}/api/v1/public/masters?${params.toString()}`, {
    method: "GET",
    headers: buildInternalHeaders()
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(payload?.data?.items)) {
    return [] as Array<{ id: string; displayName: string }>;
  }
  return payload.data.items.map((item: Record<string, unknown>) => ({
    id: String(item.id ?? ""),
    displayName: String(item.displayName ?? "")
  }));
}

async function getTenantTimezoneForConversation() {
  try {
    if (botTenantSlug && apiUrl && internalApiSecret) {
      const response = await fetchWithApiRetry(`${apiUrl}/api/v1/public/tenants/${botTenantSlug}`, {
        method: "GET",
        headers: buildInternalHeaders()
      });
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

async function getTenantBotConfig() {
  try {
    if (botTenantSlug && apiUrl && internalApiSecret) {
      const response = await fetchWithApiRetry(`${apiUrl}/api/v1/public/tenants/${botTenantSlug}`, {
        method: "GET",
        headers: buildInternalHeaders()
      });
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
          adminNotificationWhatsappE164:
            typeof payload.data.botConfig?.adminNotificationWhatsappE164 === "string"
              ? payload.data.botConfig.adminNotificationWhatsappE164
              : null
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
    adminNotificationWhatsappE164: null as string | null
  };
}

async function notifyAdminWhatsAppHandoff(input: {
  phone: string;
  summary: string;
  locale: SupportedLocale;
}) {
  const config = await getTenantBotConfig();
  if (!config.humanHandoffEnabled || !config.adminNotificationWhatsappE164) {
    return false;
  }

  const text =
    input.locale === "it"
      ? `Nuova richiesta di assistenza umana.\nCliente: ${maskPhone(input.phone)}\nTenant: ${config.name}\nRichiesta: ${input.summary}`
      : `New human handoff request.\nClient: ${maskPhone(input.phone)}\nTenant: ${config.name}\nRequest: ${input.summary}`;

  const result = await sendWhatsAppMessage({
    to: config.adminNotificationWhatsappE164,
    text: text.slice(0, 1024)
  });
  return result.sent;
}

async function fetchServiceDuration(serviceId: string): Promise<number | null> {
  if (!apiUrl || !internalApiSecret || (!botTenantSlug && !botTenantId)) {
    return null;
  }
  const response = await fetchWithApiRetry(`${apiUrl}/api/v1/public/services?locale=en`, {
    method: "GET",
    headers: buildInternalHeaders()
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
}) {
  if (!apiUrl || !internalApiSecret || (!botTenantSlug && !botTenantId)) {
    throw new Error("bot_api_config_missing");
  }

  const durationMinutes = await fetchServiceDuration(input.serviceId);
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
      ...buildInternalHeaders(),
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
    throw new Error(payload?.error?.message ?? "booking_create_failed");
  }

  return payload?.data?.bookingId ? String(payload.data.bookingId) : "ok";
}

async function cancelBookingFromBot(input: { bookingId: string; phone: string }) {
  if (!apiUrl || !internalApiSecret || (!botTenantSlug && !botTenantId)) {
    throw new Error("bot_api_config_missing");
  }

  const response = await fetchWithApiRetry(`${apiUrl}/api/v1/public/bookings/${input.bookingId}/cancel`, {
    method: "POST",
    headers: {
      ...buildInternalHeaders(),
      "idempotency-key": randomUUID()
    },
    body: JSON.stringify({
      clientPhoneE164: input.phone,
      reason: "Cancelled via telegram bot"
    })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? "booking_cancel_failed");
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
}) {
  if (!apiUrl || !internalApiSecret || (!botTenantSlug && !botTenantId)) {
    throw new Error("bot_api_config_missing");
  }

  const durationMinutes = await fetchServiceDuration(input.serviceId);
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
      ...buildInternalHeaders(),
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
    throw new Error(payload?.error?.message ?? "booking_reschedule_failed");
  }

  return payload?.data?.newBookingId ? String(payload.data.newBookingId) : "ok";
}

async function applyAdminBookingActionFromBot(input: {
  bookingId: string;
  adminPhoneE164: string;
  action: "confirm" | "cancel";
}) {
  if (!apiUrl || !internalApiSecret || (!botTenantSlug && !botTenantId)) {
    throw new Error("bot_api_config_missing");
  }

  const response = await fetchWithApiRetry(`${apiUrl}/api/v1/public/bookings/${input.bookingId}/admin-action`, {
    method: "POST",
    headers: {
      ...buildInternalHeaders(),
      "idempotency-key": randomUUID()
    },
    body: JSON.stringify({
      adminPhoneE164: input.adminPhoneE164,
      action: input.action
    })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? "booking_admin_action_failed");
  }
  return {
    bookingId: String(payload?.data?.bookingId ?? input.bookingId),
    status: String(payload?.data?.status ?? ""),
    applied: payload?.data?.applied !== false
  };
}

async function listBookingsByPhoneFromBot(input: { phone: string; limit?: number }): Promise<
  Array<{
    id: string;
    startAt: string;
    status: string;
    serviceId: string;
    masterId?: string;
    clientLocale?: SupportedLocale;
  }>
> {
  if (!apiUrl || !internalApiSecret || (!botTenantSlug && !botTenantId)) {
    return [] as Array<{
      id: string;
      startAt: string;
      status: string;
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
    headers: buildInternalHeaders()
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(payload?.data?.items)) {
    return [] as Array<{
      id: string;
      startAt: string;
      status: string;
      serviceId: string;
      masterId?: string;
      clientLocale?: SupportedLocale;
    }>;
  }
  return payload.data.items
    .map((item: Record<string, unknown>) => ({
      id: String(item.id ?? ""),
      startAt: String(item.startAt ?? ""),
      status: String(item.status ?? ""),
      serviceId: String(item.serviceId ?? ""),
      masterId: item.masterId ? String(item.masterId) : undefined,
      clientLocale:
        item.clientLocale === "it" || item.clientLocale === "en"
          ? (item.clientLocale as SupportedLocale)
          : undefined
    }))
    .filter(
      (item: { id: string; startAt: string; status: string; serviceId: string }) =>
        item.id && item.startAt && item.serviceId
    );
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

function formatDateChoiceLabel(dateIso: string, locale: SupportedLocale, timezone: string) {
  return new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    timeZone: timezone
  }).format(new Date(`${dateIso}T00:00:00.000Z`));
}

async function sendRescheduleDateChoices(input: {
  to: string;
  locale: SupportedLocale;
  serviceId: string;
  masterId?: string;
}) {
  const timezone = await getTenantTimezoneForConversation();
  const dates = getNextDays(timezone, 10);
  const choices: Array<{ id: string; title: string; description?: string }> = [];
  for (const date of dates) {
    const slots = await fetchSlotsFromApi({
      serviceId: input.serviceId,
      masterId: input.masterId,
      date,
      locale: input.locale
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
          : "I cannot find available slots for rescheduling right now."
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
    ]
  });
}

async function handleWhatsAppCtaReply(input: {
  from: string;
  replyId: string;
  locale: SupportedLocale;
}) {
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
          : "Action is invalid or expired. Please retry from the menu."
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
    bookingId
  });

  if (action.startsWith("client_") && ownerPhone !== input.from) {
    await sendWhatsAppMessage({
      to: input.from,
      text: input.locale === "it" ? "Azione non autorizzata." : "Unauthorized action."
    });
    return true;
  }

  if (action.startsWith("admin_") && ownerPhone !== input.from) {
    await sendWhatsAppMessage({
      to: input.from,
      text: input.locale === "it" ? "Azione admin non autorizzata." : "Unauthorized admin action."
    });
    return true;
  }

  if (action.startsWith("flow_") && ownerPhone !== input.from) {
    await sendWhatsAppMessage({
      to: input.from,
      text: input.locale === "it" ? "Azione non autorizzata." : "Unauthorized action."
    });
    return true;
  }

  if (action === "client_confirm") {
    await sendWhatsAppMessage({
      to: input.from,
      text:
        input.locale === "it"
          ? "Perfetto, confermato. Ti aspettiamo."
          : "Great, confirmed. We look forward to seeing you."
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
            : "Cannot confirm cancellation right now."
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
      ]
    });
    return true;
  }

  if (action === "client_cancel_confirm") {
    try {
      await cancelBookingFromBot({
        bookingId,
        phone: ownerPhone
      });
      await sendWhatsAppMessage({
        to: input.from,
        text: input.locale === "it" ? "Prenotazione annullata." : "Booking cancelled."
      });
    } catch {
      await sendWhatsAppMessage({
        to: input.from,
        text:
          input.locale === "it"
            ? "Impossibile annullare la prenotazione. Verifica lo stato."
            : "Unable to cancel the booking. Please verify its current status."
      });
    }
    return true;
  }

  if (action === "client_reschedule") {
    const bookings = await listBookingsByPhoneFromBot({
      phone: ownerPhone,
      limit: 20
    });
    const booking = bookings.find((item) => item.id === bookingId && (item.status === "pending" || item.status === "confirmed"));
    if (!booking) {
      await sendWhatsAppMessage({
        to: input.from,
        text:
          input.locale === "it"
            ? "Non trovo una prenotazione attiva da spostare."
            : "I cannot find an active booking to reschedule."
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
    await saveWhatsAppSession(input.from, session);
    await sendRescheduleDateChoices({
      to: input.from,
      locale: input.locale,
      serviceId: booking.serviceId,
      masterId: booking.masterId
    });
    return true;
  }

  if (action === "flow_confirm_booking") {
    const session = await loadWhatsAppSession(input.from);
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
            : "Session expired. Please retry from the menu."
      });
      await clearWhatsAppSession(input.from);
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
          locale: session.locale
        });
        await sendWhatsAppMessage({
          to: input.from,
          text:
            session.locale === "it"
              ? "Prenotazione spostata con successo."
              : "Booking rescheduled successfully."
        });
      } else {
        await createBookingFromBot({
          serviceId: session.serviceId,
          startAtIso: session.slotStartAt,
          phone: input.from,
          locale: session.locale,
          source: "whatsapp",
          masterId: session.masterId,
          clientName: session.clientName ?? "WhatsApp Client"
        });
        await sendWhatsAppMessage({
          to: input.from,
          text:
            session.locale === "it"
              ? "Richiesta prenotazione ricevuta. Attendi conferma dall'amministratore."
              : "Booking request received. Please wait for admin confirmation."
        });
      }
    } catch {
      await sendWhatsAppMessage({
        to: input.from,
        text:
          input.locale === "it"
            ? "Non riesco a completare l'operazione ora. Riprova dal menu."
            : "Unable to complete the action now. Please retry from the menu."
      });
    }
    await clearWhatsAppSession(input.from);
    return true;
  }

  if (action === "flow_confirm_cancel") {
    const session = await loadWhatsAppSession(input.from);
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
            : "Session expired. Please retry from the menu."
      });
      await clearWhatsAppSession(input.from);
      return true;
    }
    try {
      await cancelBookingFromBot({
        bookingId: bookingIdToCancel,
        phone: ownerPhone
      });
      await sendWhatsAppMessage({
        to: input.from,
        text: input.locale === "it" ? "Prenotazione annullata." : "Booking cancelled."
      });
    } catch {
      await sendWhatsAppMessage({
        to: input.from,
        text:
          input.locale === "it"
            ? "Impossibile annullare la prenotazione. Verifica lo stato."
            : "Unable to cancel the booking. Please verify its current status."
      });
    }
    await clearWhatsAppSession(input.from);
    return true;
  }

  if (action === "admin_confirm" || action === "admin_cancel") {
    try {
      const result = await applyAdminBookingActionFromBot({
        bookingId,
        adminPhoneE164: ownerPhone,
        action: action === "admin_confirm" ? "confirm" : "cancel"
      });
      await sendWhatsAppMessage({
        to: input.from,
        text:
          result.status === "confirmed"
            ? "Booking confirmed."
            : result.status === "cancelled"
              ? "Booking cancelled."
              : "Action applied."
      });
    } catch {
      await sendWhatsAppMessage({
        to: input.from,
        text: "Unable to apply admin action."
      });
    }
    return true;
  }

  return false;
}

async function buildStaticReply(text: string, locale: SupportedLocale) {
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
      const slots = await fetchSlotsFromApi({ serviceId, date, masterId, locale });
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
}) {
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
        clientName: name || undefined
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
      await cancelBookingFromBot({ bookingId, phone });
      return input.locale === "it"
        ? "Prenotazione annullata."
        : "Booking cancelled.";
    } catch {
      return input.locale === "it"
        ? "Impossibile annullare la prenotazione. Verifica codice e telefono."
        : "Unable to cancel booking. Please verify booking code and phone.";
    }
  }

  const staticReply = await buildStaticReply(input.text, input.locale);
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

app.get("/health", (c) => {
  return c.json({ data: { status: "ok", service: "bot" } });
});

app.get("/ready", async (c) => {
  const [apiStatus, redisStatus] = await Promise.all([checkApiHealth(), checkRedisHealth()]);
  const ready = apiStatus !== "error" && redisStatus !== "error";

  return c.json(
    {
      data: {
        status: ready ? "ready" : "not_ready",
        service: "bot",
        checks: {
          redis: redisStatus,
          api: apiStatus
        }
      }
    },
    ready ? 200 : 503
  );
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
      try {
        const notDuplicate = await dedupInboundMessage(item.messageId);
        if (!notDuplicate) {
          console.info("[bot] whatsapp duplicate ignored", {
            messageId: item.messageId,
            from: maskPhone(item.from)
          });
          continue;
        }

      const existingSession = await loadWhatsAppSession(item.from);
      const localeResolution = resolveConversationLocale({
        text: item.text,
        rawInboundLocale: item.locale,
        sessionLocale: existingSession?.locale,
        tenantDefaultLocale: "it"
      });
      const effectiveLocale = localeResolution.resolvedLocale;

      console.info("[bot] whatsapp inbound message", {
        messageId: item.messageId,
        from: maskPhone(item.from),
        hasText: Boolean(item.text),
        hasReplyId: Boolean(item.replyId),
        locale: effectiveLocale,
        localeReason: localeResolution.localeReason
      });

      const rateLimit = await checkInboundRateLimit({
        phone: item.from,
        windowSeconds: rateLimitWindowSeconds,
        maxMessages: rateLimitMaxMessages
      });
      if (!rateLimit.allowed) {
        await sendWhatsAppMessage({
          to: item.from,
          text:
            effectiveLocale === "it"
              ? "Hai inviato troppi messaggi in poco tempo. Riprova tra circa un minuto."
              : "You sent too many messages in a short time. Please try again in about a minute."
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

      if (item.replyId?.startsWith("cta:")) {
        const handledCta = await handleWhatsAppCtaReply({
          from: item.from,
          replyId: item.replyId,
          locale: effectiveLocale
        });
        if (handledCta) {
          continue;
        }
      }

      const resetResult = await applyConversationResetPolicy(
        {
          session: existingSession,
          locale: effectiveLocale,
          text: item.text,
          replyId: item.replyId,
          now: new Date(),
          idleResetMinutes: sessionIdleResetMinutes
        },
        {
          fetchServices: fetchServicesForConversation,
          fetchMasters: fetchMastersForConversation
        }
      );
      await saveWhatsAppSession(item.from, resetResult.session);
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
        hasReplyId: Boolean(item.replyId),
        localeReason: localeResolution.localeReason,
        resetApplied: resetResult.shouldResetSession,
        rerouteAfterReset: resetResult.shouldRerouteCurrentMessage,
        currentStepContinuationMatched: resetResult.currentStepContinuationMatched,
        continuationClassifier: resetResult.continuationClassifier,
        matchedCandidateCount: resetResult.matchedCandidateCount,
        matchedCandidateType: resetResult.matchedCandidateType
      });

      const conversationDeps = {
        dedupInboundMessage,
        loadSession: loadWhatsAppSession,
        saveSession: saveWhatsAppSession,
        clearSession: clearWhatsAppSession,
        sendText: async (to: string, text: string) => {
          await sendWhatsAppMessage({ to, text });
        },
        sendList: async (to: string, bodyText: string, buttonText: string, choices: Array<{ id: string; title: string; description?: string }>) => {
          await sendWhatsAppList({ to, bodyText, buttonText, choices });
        },
        sendButtons: async (to: string, bodyText: string, choices: Array<{ id: string; title: string; description?: string }>) => {
          await sendWhatsAppButtons({ to, bodyText, choices });
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
        fetchServices: fetchServicesForConversation,
        fetchMasters: fetchMastersForConversation,
        fetchSlots: async (input: {
          serviceId: string;
          masterId?: string;
          date: string;
          locale: SupportedLocale;
        }) => fetchSlotsFromApi(input),
        listBookingsByPhone: listBookingsByPhoneFromBot,
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
            clientName: input.clientName
          }),
        cancelBooking: cancelBookingFromBot,
        rescheduleBooking: rescheduleBookingFromBot,
        getTenantTimezone: getTenantTimezoneForConversation
      };

      let flowResult = { handled: false };
      const shouldAttemptAiFromChooseIntent =
        resetResult.decision === "continue_current_flow" &&
        resetResult.session.state === "choose_intent" &&
        !resetResult.session.intent &&
        !item.replyId &&
        Boolean(item.text) &&
        !isStructuredControlMessage(item.text ?? "");

      if (
        !resetResult.shouldFallbackToMenuImmediately &&
        !item.replyId &&
        item.text &&
        !isStructuredControlMessage(item.text) &&
        (resetResult.shouldRerouteCurrentMessage || shouldAttemptAiFromChooseIntent)
      ) {
        const aiEnabledForTenant = openAiResponsesEnabled && isAiCanaryEnabledForTenant();
        if (!aiEnabledForTenant) {
          console.info("[bot] ai canary disabled for tenant", {
            messageId: item.messageId,
            tenantSlug: botTenantSlug || null,
            tenantId: botTenantId || null
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
            text: item.text,
            locale: effectiveLocale,
            openAiApiKey,
            globalModel: openAiModel,
            globalEnabled: aiEnabledForTenant,
            tenantQuotaKey: botTenantSlug || botTenantId || "default",
            aiMaxCallsPerSession: openAiMaxCallsPerSession,
            aiMaxCallsPerDay: openAiMaxCallsPerDay,
            aiFailureHandoffThreshold,
            unknownTurnHandoffThreshold
          },
          {
            loadSession: loadWhatsAppSession,
            saveSession: saveWhatsAppSession,
            clearSession: clearWhatsAppSession,
            sendText: async (to, text) => {
              await sendWhatsAppMessage({ to, text });
            },
            sendList: async (to, bodyText, buttonText, choices) => {
              await sendWhatsAppList({ to, bodyText, buttonText, choices });
            },
            sendButtons: async (to, bodyText, choices) => {
              await sendWhatsAppButtons({ to, bodyText, choices });
            },
            fetchServices: fetchServicesForConversation,
            fetchMasters: fetchMastersForConversation,
            fetchSlots: async (payload) => fetchSlotsFromApi(payload),
            listBookingsByPhone: listBookingsByPhoneFromBot,
            createBooking: async (payload) =>
              createBookingFromBot({
                serviceId: payload.serviceId,
                startAtIso: payload.startAtIso,
                phone: payload.phone,
                locale: payload.locale,
                source: "whatsapp",
                masterId: payload.masterId,
                clientName: payload.clientName
              }),
            cancelBooking: cancelBookingFromBot,
            rescheduleBooking: rescheduleBookingFromBot,
            getTenantConfig: getTenantBotConfig,
            notifyAdminHandoff: notifyAdminWhatsAppHandoff,
            emitOpsAlert,
            consumeAiDailyQuota
          }
        );
        flowResult = aiResult;
      }

      if (!flowResult.handled) {
        flowResult = await processWhatsAppConversation(
          {
            messageId: item.messageId,
            from: item.from,
            locale: effectiveLocale,
            text:
              !item.replyId && resetResult.decision === "hard_reset_to_new_intent"
                ? toDeterministicIntentToken(resetResult.detectedIntent) ?? item.text
                : item.text,
            replyId:
              !item.replyId && resetResult.decision === "hard_reset_to_new_intent"
                ? toDeterministicIntentToken(resetResult.detectedIntent)
                : item.replyId
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

        if (!flowResult.handled && item.text) {
          const replyText = await processIncomingText({
            text: item.text,
            locale: effectiveLocale,
            source: "whatsapp",
            senderPhoneE164: item.from
          });
          await sendWhatsAppMessage({ to: item.from, text: replyText });
          console.info("[bot] whatsapp fallback reply sent", {
            messageId: item.messageId,
            from: maskPhone(item.from)
          });
        }
      } catch (error) {
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
                : "Service is temporarily unavailable. Please retry in a few seconds."
          });
        } catch (fallbackError) {
          console.error("[bot] fallback whatsapp send failed", {
            messageId: item.messageId,
            from: maskPhone(item.from),
            error: toLogError(fallbackError)
          });
        }
        continue;
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

serve({
  fetch: app.fetch,
  port
});

console.log(`[bot] listening on :${port}`);
