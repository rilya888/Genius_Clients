import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { resolveLocale, t, type SupportedLocale } from "@genius/i18n";
import { captureException } from "@genius/shared";
import Redis from "ioredis";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { processWhatsAppConversation, type WhatsAppConversationSession } from "./whatsapp-conversation";

const app = new Hono();
const telegramWebhookSecret = process.env.TG_WEBHOOK_SECRET_TOKEN ?? "";
const telegramBotToken = process.env.TG_BOT_TOKEN ?? "";
const waPhoneNumberId = process.env.WA_PHONE_NUMBER_ID ?? "";
const waAccessToken = process.env.WA_ACCESS_TOKEN ?? "";
const waVerifyToken = process.env.WA_VERIFY_TOKEN ?? "";
const waWebhookSecret = process.env.WA_WEBHOOK_SECRET ?? "";
const openAiApiKey = process.env.OPENAI_API_KEY ?? "";
const openAiModel = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
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
    console.error("[bot] redis client error", error);
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

async function sendTelegramMessage(input: { chatId: number; text: string }) {
  if (!telegramBotToken) {
    console.warn("[bot] TG_BOT_TOKEN is not configured; message send skipped");
    return { sent: false, reason: "missing_bot_token" as const };
  }

  const response = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: input.chatId,
      text: input.text
    })
  });

  if (!response.ok) {
    const payload = await response.text();
    console.error("[bot] telegram send failed", payload);
    await captureException({
      service: "bot",
      error: new Error(`telegram_send_failed:${response.status}`),
      context: { payload }
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

  const response = await fetch(`https://graph.facebook.com/v21.0/${waPhoneNumberId}/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${waAccessToken}`
    },
    body: JSON.stringify(input.payload)
  });

  if (!response.ok) {
    const payload = await response.text();
    console.error("[bot] whatsapp send failed", payload);
    await captureException({
      service: "bot",
      error: new Error(`whatsapp_send_failed:${response.status}`),
      context: { payload }
    });
    return { sent: false, reason: "whatsapp_api_failed" as const };
  }

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
              : undefined;
        const from = msg.from;
        const messageId = msg.id;
        if (typeof from !== "string" || typeof messageId !== "string") {
          continue;
        }
        if (type === "text" && typeof text !== "string") {
          continue;
        }
        if (type === "interactive" && typeof replyId !== "string") {
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

  const response = await fetch(`${apiUrl}/api/v1/public/slots?${params.toString()}`, {
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
  const response = await fetch(`${apiUrl}/api/v1/public/services?locale=${locale}`, {
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
  const response = await fetch(`${apiUrl}/api/v1/public/masters?${params.toString()}`, {
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
  if (botTenantSlug && apiUrl && internalApiSecret) {
    const response = await fetch(`${apiUrl}/api/v1/public/tenants/${botTenantSlug}`, {
      method: "GET",
      headers: buildInternalHeaders()
    });
    const payload = await response.json().catch(() => null);
    const timezone = payload?.data?.timezone;
    if (response.ok && typeof timezone === "string" && timezone) {
      return timezone;
    }
  }
  return "Europe/Rome";
}

async function fetchServiceDuration(serviceId: string): Promise<number | null> {
  if (!apiUrl || !internalApiSecret || (!botTenantSlug && !botTenantId)) {
    return null;
  }
  const response = await fetch(`${apiUrl}/api/v1/public/services?locale=en`, {
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

  const response = await fetch(`${apiUrl}/api/v1/public/bookings`, {
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

  const response = await fetch(`${apiUrl}/api/v1/public/bookings/${input.bookingId}/cancel`, {
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
  const response = await fetch(`${apiUrl}/api/v1/public/bookings/${input.bookingId}/reschedule`, {
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

async function listBookingsByPhoneFromBot(input: { phone: string; limit?: number }) {
  if (!apiUrl || !internalApiSecret || (!botTenantSlug && !botTenantId)) {
    return [] as Array<{ id: string; startAt: string; status: string }>;
  }
  const params = new URLSearchParams({
    clientPhoneE164: input.phone
  });
  if (input.limit && Number.isFinite(input.limit)) {
    params.set("limit", String(Math.trunc(input.limit)));
  }
  const response = await fetch(`${apiUrl}/api/v1/public/bookings?${params.toString()}`, {
    method: "GET",
    headers: buildInternalHeaders()
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(payload?.data?.items)) {
    return [] as Array<{ id: string; startAt: string; status: string }>;
  }
  return payload.data.items
    .map((item: Record<string, unknown>) => ({
      id: String(item.id ?? ""),
      startAt: String(item.startAt ?? ""),
      status: String(item.status ?? "")
    }))
    .filter((item: { id: string; startAt: string; status: string }) => item.id && item.startAt);
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

      const top = slots.slice(0, 10).map((item) => item.displayTime ?? "?").join(", ");
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

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${openAiApiKey}`
    },
    body: JSON.stringify({
      model: openAiModel,
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: input.text }
      ]
    })
  });

  if (!response.ok) {
    return input.locale === "it"
      ? "Messaggio ricevuto. Un operatore la ricontattera a breve."
      : "Message received. An operator will contact you shortly.";
  }

  const payload = await response.json().catch(() => null);
  const aiText = payload?.choices?.[0]?.message?.content;
  if (typeof aiText !== "string" || !aiText.trim()) {
    return input.locale === "it"
      ? "Messaggio ricevuto. Un operatore la ricontattera a breve."
      : "Message received. An operator will contact you shortly.";
  }

  return aiText.trim();
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
      const bookingId = await createBookingFromBot({
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
        ? `Prenotazione creata con successo. Codice: ${bookingId}`
        : `Booking created successfully. Code: ${bookingId}`;
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
      const cancelledId = await cancelBookingFromBot({ bookingId, phone });
      return input.locale === "it"
        ? `Prenotazione annullata. Codice: ${cancelledId}`
        : `Booking cancelled. Code: ${cancelledId}`;
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
    return c.text(challenge, 200);
  }

  return c.json({ error: { code: "AUTH_FORBIDDEN", message: "Invalid WhatsApp verify token" } }, 403);
});

app.post("/webhooks/whatsapp", async (c) => {
  const rawBody = await c.req.text();
  try {
    assertWhatsAppSignature(c.req.header("x-hub-signature-256"), rawBody);
    const payload = JSON.parse(rawBody) as unknown;
    const inbound = extractWhatsAppInbound(payload);

    for (const item of inbound) {
      const flowResult = await processWhatsAppConversation(
        {
          messageId: item.messageId,
          from: item.from,
          locale: item.locale,
          text: item.text,
          replyId: item.replyId
        },
        {
          dedupInboundMessage,
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
          fetchSlots: async (input) => fetchSlotsFromApi(input),
          listBookingsByPhone: listBookingsByPhoneFromBot,
          createBooking: async (input) =>
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
        }
      );

      if (!flowResult.handled && item.text) {
        const replyText = await processIncomingText({
          text: item.text,
          locale: item.locale,
          source: "whatsapp",
          senderPhoneE164: item.from
        });
        await sendWhatsAppMessage({ to: item.from, text: replyText });
      }
    }

    return c.json({
      data: {
        accepted: true,
        processed: inbound.length
      }
    });
  } catch (error) {
    await captureException({
      service: "bot",
      error,
      context: { route: "/webhooks/whatsapp" }
    });
    return c.json({ error: { code: "INTERNAL_ERROR", message: "Internal error" } }, 500);
  }
});

const port = Number(process.env.PORT ?? 3002);

serve({
  fetch: app.fetch,
  port
});

console.log(`[bot] listening on :${port}`);
