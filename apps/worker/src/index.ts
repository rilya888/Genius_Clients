import { createServer } from "node:http";
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import {
  bookings,
  channelEndpointsV2,
  createDbClient,
  emailVerificationTokens,
  idempotencyKeys,
  masters,
  notificationDeliveries,
  passwordResetTokens,
  refreshTokens,
  services,
  tenants,
  whatsappContactWindows
} from "@genius/db";
import { captureException, createBookingActionToken } from "@genius/shared";
import Redis from "ioredis";

const heartbeatIntervalMs = Number(process.env.WORKER_HEARTBEAT_MS ?? 15000);
const reminderPollIntervalMs = Number(process.env.WORKER_REMINDER_POLL_MS ?? 60000);
const deliveryPollIntervalMs = Number(process.env.WORKER_DELIVERY_POLL_MS ?? 30000);
const cleanupPollIntervalMs = Number(process.env.WORKER_CLEANUP_POLL_MS ?? 600000);
const unverifiedAccountRetentionDays = Number(process.env.UNVERIFIED_ACCOUNT_RETENTION_DAYS ?? 30);
const deliveryMaxAttempts = Number(process.env.WORKER_DELIVERY_MAX_ATTEMPTS ?? 5);
const deliveryBackoffBaseSeconds = Number(process.env.WORKER_DELIVERY_BACKOFF_BASE_SECONDS ?? 30);
const port = Number(process.env.PORT ?? 3003);
const databaseUrl = process.env.DATABASE_URL;
const db = databaseUrl ? createDbClient(databaseUrl) : null;
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
    console.error("[worker] redis client error", error);
  });
}
const telegramBotToken = process.env.TG_BOT_TOKEN ?? "";
const waPhoneNumberId = process.env.WA_PHONE_NUMBER_ID ?? "";
const waAccessToken = process.env.WA_ACCESS_TOKEN ?? "";
const waAccessTokenByPhoneRaw = process.env.WA_ACCESS_TOKEN_BY_PHONE_JSON ?? "";
const waActionTokenSecret = process.env.WA_ACTION_TOKEN_SECRET ?? "";
const waAdminActionTtlHours = Math.max(1, Number.parseInt(process.env.WA_ADMIN_ACTION_TTL_HOURS ?? "24", 10) || 24);
const waTemplateBookingCreatedAdminGlobal = process.env.WA_TEMPLATE_BOOKING_CREATED_ADMIN?.trim() ?? "";
const waTemplateReminder24hGlobal = process.env.WA_TEMPLATE_BOOKING_REMINDER_24H?.trim() ?? "";
const waTemplateReminder2hGlobal = process.env.WA_TEMPLATE_BOOKING_REMINDER_2H?.trim() ?? "";
const waTemplateLangIt = process.env.WA_TEMPLATE_LANG_IT?.trim() || "it";
const waTemplateLangEn = process.env.WA_TEMPLATE_LANG_EN?.trim() || "en";
const webUrl = (process.env.WEB_URL ?? process.env.APP_URL ?? "").trim();
const workerAdminSecret = process.env.WORKER_ADMIN_SECRET ?? "";

let isSweepRunning = false;
let isDeliveryRunning = false;
let isCleanupRunning = false;
let lastSweepAt: string | null = null;
let lastSweepError: string | null = null;
let lastDeliveryAt: string | null = null;
let lastDeliveryError: string | null = null;
let lastCleanupAt: string | null = null;
let lastCleanupError: string | null = null;
let lastSweepStats: { reminder24hQueued: number; reminder2hQueued: number } = {
  reminder24hQueued: 0,
  reminder2hQueued: 0
};
let lastDeliveryStats: { sent: number; failed: number; processed: number } = {
  sent: 0,
  failed: 0,
  processed: 0
};
let lastCleanupStats: {
  refreshDeleted: number;
  resetDeleted: number;
  verifyDeleted: number;
  idempotencyDeleted: number;
  unverifiedTenantDeleted: number;
} = {
  refreshDeleted: 0,
  resetDeleted: 0,
  verifyDeleted: 0,
  idempotencyDeleted: 0,
  unverifiedTenantDeleted: 0
};

function parseWhatsAppAccessTokenMap(raw: string): Map<string, string> {
  if (!raw.trim()) {
    return new Map();
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return new Map();
    }
    return new Map(
      Object.entries(parsed).flatMap(([phoneNumberId, token]) => {
        if (typeof token !== "string" || !token.trim()) {
          return [];
        }
        return [[phoneNumberId.trim(), token.trim()] as const];
      })
    );
  } catch {
    return new Map();
  }
}

const waAccessTokenByPhone = parseWhatsAppAccessTokenMap(waAccessTokenByPhoneRaw);

async function resolveWhatsAppCredentials(tenantId?: string): Promise<{ phoneNumberId: string; accessToken: string } | null> {
  if (tenantId && db) {
    const [endpoint] = await db
      .select({
        externalEndpointId: channelEndpointsV2.externalEndpointId
      })
      .from(channelEndpointsV2)
      .where(
        and(
          eq(channelEndpointsV2.tenantId, tenantId),
          eq(channelEndpointsV2.provider, "whatsapp"),
          eq(channelEndpointsV2.isActive, true),
          eq(channelEndpointsV2.bindingStatus, "connected")
        )
      )
      .orderBy(desc(channelEndpointsV2.updatedAt))
      .limit(1);

    const routedPhoneNumberId = endpoint?.externalEndpointId?.trim();
    if (routedPhoneNumberId) {
      const routedToken = waAccessTokenByPhone.get(routedPhoneNumberId) ?? waAccessToken;
      if (routedToken?.trim()) {
        return { phoneNumberId: routedPhoneNumberId, accessToken: routedToken.trim() };
      }
    }
  }

  if (waPhoneNumberId && waAccessToken) {
    return { phoneNumberId: waPhoneNumberId, accessToken: waAccessToken };
  }
  return null;
}

type WhatsAppWindowPolicy = {
  mode: "session" | "template";
  templateName: string | null;
  templateLang: string;
  windowOpen: boolean;
  reason: "window_open" | "window_expired" | "no_window_record";
  checkedAt: Date;
};

function toTemplateLang(locale: string | null | undefined) {
  return locale === "en" ? waTemplateLangEn : waTemplateLangIt;
}

async function resolveTenantTemplateConfig(input: { tenantId: string }) {
  if (!db) {
    return {
      bookingCreatedAdminTemplateName: null,
      bookingReminder24hTemplateName: null,
      bookingReminder2hTemplateName: null
    };
  }
  const [endpoint] = await db
    .select({
      bookingCreatedAdminTemplateName: channelEndpointsV2.bookingCreatedAdminTemplateName,
      bookingReminder24hTemplateName: channelEndpointsV2.bookingReminder24hTemplateName,
      bookingReminder2hTemplateName: channelEndpointsV2.bookingReminder2hTemplateName
    })
    .from(channelEndpointsV2)
    .where(
      and(
        eq(channelEndpointsV2.tenantId, input.tenantId),
        eq(channelEndpointsV2.provider, "whatsapp"),
        eq(channelEndpointsV2.isActive, true),
        eq(channelEndpointsV2.bindingStatus, "connected")
      )
    )
    .orderBy(desc(channelEndpointsV2.updatedAt))
    .limit(1);
  return {
    bookingCreatedAdminTemplateName: endpoint?.bookingCreatedAdminTemplateName?.trim() || null,
    bookingReminder24hTemplateName: endpoint?.bookingReminder24hTemplateName?.trim() || null,
    bookingReminder2hTemplateName: endpoint?.bookingReminder2hTemplateName?.trim() || null
  };
}

async function resolveWhatsAppWindowPolicy(input: {
  tenantId: string;
  senderPhoneNumberId: string;
  recipientE164: string;
  notificationType: string;
  fallbackLocale?: string | null;
}): Promise<WhatsAppWindowPolicy> {
  const checkedAt = new Date();
  let lastInboundAt: Date | null = null;
  let lastKnownLocale: string | null = null;

  if (db) {
    const [windowRow] = await db
      .select({
        lastInboundAt: whatsappContactWindows.lastInboundAt,
        lastKnownLocale: whatsappContactWindows.lastKnownLocale
      })
      .from(whatsappContactWindows)
      .where(
        and(
          eq(whatsappContactWindows.tenantId, input.tenantId),
          eq(whatsappContactWindows.senderPhoneNumberId, input.senderPhoneNumberId),
          eq(whatsappContactWindows.recipientE164, input.recipientE164)
        )
      )
      .limit(1);
    lastInboundAt = windowRow?.lastInboundAt ?? null;
    lastKnownLocale = windowRow?.lastKnownLocale ?? null;
  }

  const twentyFourHoursAgo = new Date(checkedAt.getTime() - 24 * 60 * 60 * 1000);
  const isWindowOpen = !!(lastInboundAt && lastInboundAt >= twentyFourHoursAgo);
  if (isWindowOpen) {
    return {
      mode: "session",
      templateName: null,
      templateLang: toTemplateLang(lastKnownLocale ?? input.fallbackLocale),
      windowOpen: true,
      reason: "window_open",
      checkedAt
    };
  }

  const templates = await resolveTenantTemplateConfig({ tenantId: input.tenantId });
  let templateName: string | null = null;
  if (input.notificationType === "booking_created_admin") {
    templateName = templates.bookingCreatedAdminTemplateName ?? waTemplateBookingCreatedAdminGlobal;
  } else if (input.notificationType === "booking_reminder_24h") {
    templateName = templates.bookingReminder24hTemplateName ?? waTemplateReminder24hGlobal;
  } else if (input.notificationType === "booking_reminder_2h") {
    templateName = templates.bookingReminder2hTemplateName ?? waTemplateReminder2hGlobal;
  }

  return {
    mode: "template",
    templateName: templateName?.trim() || null,
    templateLang: toTemplateLang(lastKnownLocale ?? input.fallbackLocale),
    windowOpen: false,
    reason: lastInboundAt ? "window_expired" : "no_window_record",
    checkedAt
  };
}

async function pingRedis(): Promise<"ok" | "disabled" | "error"> {
  if (!redis) {
    return "disabled";
  }

  try {
    if (redis.status === "wait") {
      await redis.connect();
    }
    const pong = await redis.ping();
    return pong === "PONG" ? "ok" : "error";
  } catch {
    return "error";
  }
}

function hoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

function computeBackoffSeconds(attemptCount: number): number {
  const safeAttempt = Math.max(1, attemptCount);
  const exponential = deliveryBackoffBaseSeconds * 2 ** (safeAttempt - 1);
  return Math.min(exponential, 1800);
}

async function queueReminder(
  input: {
    bookingId: string;
    tenantId: string;
    recipient: string;
    channel: string;
    idempotencyKey: string;
    notificationType: "booking_reminder_24h" | "booking_reminder_2h";
    reminderType: "24h" | "2h";
  }
): Promise<boolean> {
  if (!db) {
    return false;
  }

  const inserted = await db
    .insert(notificationDeliveries)
    .values({
      tenantId: input.tenantId,
      bookingId: input.bookingId,
      notificationType: input.notificationType,
      channel: input.channel,
      recipient: input.recipient,
      idempotencyKey: input.idempotencyKey,
      status: "queued"
    })
    .onConflictDoNothing()
    .returning({ id: notificationDeliveries.id });

  if (inserted.length === 0) {
    return false;
  }

  if (input.reminderType === "24h") {
    await db
      .update(bookings)
      .set({
        reminder24hSentAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(bookings.id, input.bookingId));
  } else {
    await db
      .update(bookings)
      .set({
        reminder2hSentAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(bookings.id, input.bookingId));
  }

  return true;
}

async function runReminderSweep() {
  if (!db || isSweepRunning) {
    return;
  }
  isSweepRunning = true;
  lastSweepError = null;
  let reminder24hQueued = 0;
  let reminder2hQueued = 0;

  try {
    const now = new Date();
    const window24hStart = hoursFromNow(23);
    const window24hEnd = hoursFromNow(24);
    const window2hStart = hoursFromNow(1.5);
    const window2hEnd = hoursFromNow(2);

    const due24h = await db
      .select({
        id: bookings.id,
        tenantId: bookings.tenantId,
        source: bookings.source,
        clientEmail: bookings.clientEmail,
        clientPhoneE164: bookings.clientPhoneE164
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.status, "confirmed"),
          isNull(bookings.reminder24hSentAt),
          gte(bookings.startAt, window24hStart),
          lte(bookings.startAt, window24hEnd)
        )
      )
      .limit(200);

    for (const booking of due24h) {
      const recipient = booking.clientEmail ?? booking.clientPhoneE164;
      const channel = booking.clientEmail
        ? "email"
        : booking.source === "telegram"
          ? "telegram"
          : booking.source === "whatsapp"
            ? "whatsapp"
            : "email";
      const created = await queueReminder({
        bookingId: booking.id,
        tenantId: booking.tenantId,
        recipient,
        channel,
        idempotencyKey: `${booking.id}:reminder24h`,
        notificationType: "booking_reminder_24h",
        reminderType: "24h"
      });
      if (created) {
        reminder24hQueued += 1;
      }
    }

    const due2h = await db
      .select({
        id: bookings.id,
        tenantId: bookings.tenantId,
        source: bookings.source,
        clientEmail: bookings.clientEmail,
        clientPhoneE164: bookings.clientPhoneE164
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.status, "confirmed"),
          isNull(bookings.reminder2hSentAt),
          gte(bookings.startAt, window2hStart),
          lte(bookings.startAt, window2hEnd)
        )
      )
      .limit(200);

    for (const booking of due2h) {
      const recipient = booking.clientEmail ?? booking.clientPhoneE164;
      const channel = booking.clientEmail
        ? "email"
        : booking.source === "telegram"
          ? "telegram"
          : booking.source === "whatsapp"
            ? "whatsapp"
            : "email";
      const created = await queueReminder({
        bookingId: booking.id,
        tenantId: booking.tenantId,
        recipient,
        channel,
        idempotencyKey: `${booking.id}:reminder2h`,
        notificationType: "booking_reminder_2h",
        reminderType: "2h"
      });
      if (created) {
        reminder2hQueued += 1;
      }
    }

    lastSweepAt = now.toISOString();
    lastSweepStats = { reminder24hQueued, reminder2hQueued };
    console.log("[worker] reminder sweep completed", { reminder24hQueued, reminder2hQueued });
  } catch (error) {
    lastSweepError = error instanceof Error ? error.message : "unknown_sweep_error";
    console.error("[worker] reminder sweep failed", error);
    await captureException({
      service: "worker",
      error,
      context: { phase: "reminder_sweep" }
    });
  } finally {
    isSweepRunning = false;
  }
}

async function sendTelegramMessage(input: { chatId: string; text: string }) {
  if (!telegramBotToken) {
    throw new Error("missing_tg_bot_token");
  }

  const response = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: input.chatId,
      text: input.text
    })
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`telegram_send_failed:${response.status}`);
  }

  const messageId = payload?.result?.message_id;
  return String(messageId ?? "telegram_sent");
}

async function buildBookingDetailsText(input: { bookingId: string; notificationType: string }) {
  if (!db) {
    return null;
  }

  const row = await db
    .select({
      startAt: bookings.startAt,
      clientLocale: bookings.clientLocale,
      serviceName: services.displayName,
      rejectionReason: bookings.rejectionReason,
      timezone: tenants.timezone
    })
    .from(bookings)
    .innerJoin(services, eq(services.id, bookings.serviceId))
    .leftJoin(masters, eq(masters.id, bookings.masterId))
    .innerJoin(tenants, eq(tenants.id, bookings.tenantId))
    .where(eq(bookings.id, input.bookingId))
    .limit(1);

  const details = row[0];
  if (!details) {
    return null;
  }

  const locale = details.clientLocale === "it" ? "it-IT" : "en-GB";
  const when = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: details.timezone || "Europe/Rome"
  }).format(details.startAt);

  if (input.notificationType === "booking_confirmed_client") {
    return details.clientLocale === "it"
      ? `Prenotazione confermata: ${details.serviceName}, ${when}.`
      : `Booking confirmed: ${details.serviceName}, ${when}.`;
  }

  if (input.notificationType === "booking_cancelled") {
    return details.clientLocale === "it"
      ? `Prenotazione annullata: ${details.serviceName}, ${when}.`
      : `Booking cancelled: ${details.serviceName}, ${when}.`;
  }

  if (input.notificationType === "booking_completed_client") {
    return details.clientLocale === "it"
      ? `Servizio completato: ${details.serviceName}, ${when}.`
      : `Service completed: ${details.serviceName}, ${when}.`;
  }

  if (input.notificationType === "booking_rejected_client") {
    const reason = details.rejectionReason?.trim();
    if (details.clientLocale === "it") {
      return reason
        ? `Prenotazione rifiutata: ${details.serviceName}, ${when}. Motivo: ${reason}`
        : `Prenotazione rifiutata: ${details.serviceName}, ${when}.`;
    }
    return reason
      ? `Booking rejected: ${details.serviceName}, ${when}. Reason: ${reason}`
      : `Booking rejected: ${details.serviceName}, ${when}.`;
  }

  return null;
}

async function buildAdminApprovalPayload(input: { bookingId: string; recipient: string }) {
  if (!db || !waActionTokenSecret) {
    return null;
  }

  const row = await db
    .select({
      bookingId: bookings.id,
      serviceName: services.displayName,
      masterName: masters.displayName,
      clientName: bookings.clientName,
      startAt: bookings.startAt,
      tenantLocale: tenants.defaultLocale,
      timezone: tenants.timezone
    })
    .from(bookings)
    .innerJoin(services, eq(services.id, bookings.serviceId))
    .leftJoin(masters, eq(masters.id, bookings.masterId))
    .innerJoin(tenants, eq(tenants.id, bookings.tenantId))
    .where(eq(bookings.id, input.bookingId))
    .limit(1);
  const details = row[0];
  if (!details) {
    return null;
  }

  const locale = details.tenantLocale === "en" ? "en" : "it";
  const when = new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: details.timezone || "Europe/Rome"
  }).format(details.startAt);

  const expiresAtUnix = Math.floor(Date.now() / 1000) + waAdminActionTtlHours * 60 * 60;
  const confirmToken = createBookingActionToken(
    {
      action: "admin_confirm",
      bookingId: details.bookingId,
      phoneE164: input.recipient,
      expiresAtUnix
    },
    waActionTokenSecret
  );
  const rejectToken = createBookingActionToken(
    {
      action: "admin_reject",
      bookingId: details.bookingId,
      phoneE164: input.recipient,
      expiresAtUnix
    },
    waActionTokenSecret
  );

  const shortId = details.bookingId.slice(0, 8);
  const masterName = details.masterName || (locale === "it" ? "Non assegnato" : "Unassigned");
  const webLink = webUrl ? `${webUrl.replace(/\/$/, "")}/app/bookings` : null;
  const text =
    locale === "it"
      ? `Nuova prenotazione #${shortId}\nCliente: ${details.clientName}\nServizio: ${details.serviceName}\nMaster: ${masterName}\nQuando: ${when}\nConfermi questa prenotazione?${webLink ? `\nApri web: ${webLink}` : ""}`
      : `New booking #${shortId}\nClient: ${details.clientName}\nService: ${details.serviceName}\nSpecialist: ${masterName}\nWhen: ${when}\nDo you confirm this booking?${webLink ? `\nOpen web: ${webLink}` : ""}`;

  return {
    text,
    confirmToken,
    rejectToken,
    locale,
    webLink
  };
}

async function resolvePolicyFallbackLocale(input: {
  bookingId: string | null;
  notificationType: string;
}): Promise<"it" | "en" | null> {
  if (!db || !input.bookingId) {
    return null;
  }
  if (
    input.notificationType === "booking_reminder_24h" ||
    input.notificationType === "booking_reminder_2h" ||
    input.notificationType === "booking_confirmed_client" ||
    input.notificationType === "booking_cancelled" ||
    input.notificationType === "booking_completed_client" ||
    input.notificationType === "booking_rejected_client"
  ) {
    const [row] = await db
      .select({ clientLocale: bookings.clientLocale })
      .from(bookings)
      .where(eq(bookings.id, input.bookingId))
      .limit(1);
    return row?.clientLocale === "en" ? "en" : "it";
  }
  if (input.notificationType === "booking_created_admin") {
    const [row] = await db
      .select({ tenantLocale: tenants.defaultLocale })
      .from(bookings)
      .innerJoin(tenants, eq(tenants.id, bookings.tenantId))
      .where(eq(bookings.id, input.bookingId))
      .limit(1);
    return row?.tenantLocale === "en" ? "en" : "it";
  }
  return null;
}

async function sendByChannel(input: {
  tenantId?: string;
  channel: string;
  recipient: string;
  notificationType: string;
  bookingId: string | null;
}) {
  const detailedText =
    input.bookingId &&
    (input.notificationType === "booking_confirmed_client" ||
      input.notificationType === "booking_cancelled" ||
      input.notificationType === "booking_completed_client" ||
      input.notificationType === "booking_rejected_client")
      ? await buildBookingDetailsText({ bookingId: input.bookingId, notificationType: input.notificationType })
      : null;

  const textByType: Record<string, string> = {
    booking_created_admin: `New booking created.`,
    booking_confirmed_client: `Booking confirmed.`,
    booking_completed_client: `Booking completed.`,
    booking_cancelled: `Booking cancelled.`,
    booking_rejected_client: `Booking rejected.`,
    booking_reminder_24h: `Reminder: your booking is in 24 hours.`,
    booking_reminder_2h: `Reminder: your booking is in 2 hours.`
  };
  const text = detailedText ?? textByType[input.notificationType] ?? `[${input.notificationType}]`;

  if (input.channel === "telegram") {
    const providerMessageId = await sendTelegramMessage({ chatId: input.recipient, text });
    return { providerMessageId };
  }

  if (input.channel === "whatsapp") {
    const credentials = await resolveWhatsAppCredentials(input.tenantId);
    if (!credentials) {
      return { providerMessageId: `wa_mock_${Date.now()}` };
    }

    const shouldApplyWindowPolicy =
      input.notificationType === "booking_created_admin" ||
      input.notificationType === "booking_reminder_24h" ||
      input.notificationType === "booking_reminder_2h";
    const fallbackLocale = await resolvePolicyFallbackLocale({
      bookingId: input.bookingId,
      notificationType: input.notificationType
    });
    const windowPolicy =
      shouldApplyWindowPolicy && input.tenantId
        ? await resolveWhatsAppWindowPolicy({
            tenantId: input.tenantId,
            senderPhoneNumberId: credentials.phoneNumberId,
            recipientE164: input.recipient,
            notificationType: input.notificationType,
            fallbackLocale
          })
        : null;
    const activeDeliveryMode = windowPolicy?.mode ?? "session";

    if (windowPolicy?.mode === "template" && !windowPolicy.templateName) {
      throw new Error(`whatsapp_template_missing:${input.notificationType}`);
    }

    if (input.notificationType === "booking_created_admin" && input.bookingId) {
      const approvalPayload = await buildAdminApprovalPayload({
        bookingId: input.bookingId,
        recipient: input.recipient
      });
      if (approvalPayload) {
        console.log("[worker][whatsapp-admin-cta] sending", {
          tenantId: input.tenantId,
          bookingId: input.bookingId,
          recipient: input.recipient,
          mode: activeDeliveryMode
        });
        const response = await fetch(
          `https://graph.facebook.com/v21.0/${credentials.phoneNumberId}/messages`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${credentials.accessToken}`
            },
            body: JSON.stringify(
              activeDeliveryMode === "template"
                ? {
                    messaging_product: "whatsapp",
                    to: input.recipient,
                    type: "template",
                    template: {
                      name: windowPolicy!.templateName,
                      language: { code: windowPolicy!.templateLang },
                      components: [
                        {
                          type: "button",
                          sub_type: "quick_reply",
                          index: "0",
                          parameters: [{ type: "payload", payload: `cta:${approvalPayload.confirmToken}` }]
                        },
                        {
                          type: "button",
                          sub_type: "quick_reply",
                          index: "1",
                          parameters: [{ type: "payload", payload: `cta:${approvalPayload.rejectToken}` }]
                        }
                      ]
                    }
                  }
                : {
                    messaging_product: "whatsapp",
                    to: input.recipient,
                    type: "interactive",
                    interactive: {
                      type: "button",
                      body: { text: approvalPayload.text.slice(0, 1024) },
                      action: {
                        buttons: [
                          {
                            type: "reply",
                            reply: {
                              id: `cta:${approvalPayload.confirmToken}`,
                              title: approvalPayload.locale === "it" ? "Conferma" : "Confirm"
                            }
                          },
                          {
                            type: "reply",
                            reply: {
                              id: `cta:${approvalPayload.rejectToken}`,
                              title: approvalPayload.locale === "it" ? "Rifiuta" : "Reject"
                            }
                          },
                          {
                            type: "reply",
                            reply: {
                              id: "admin:open_web",
                              title: approvalPayload.locale === "it" ? "Apri web" : "Open web"
                            }
                          }
                        ]
                      }
                    }
                  }
            )
          }
        );

        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          const code = payload && typeof payload === "object" ? (payload as { error?: { code?: number } }).error?.code : null;
          const message =
            payload && typeof payload === "object"
              ? (payload as { error?: { message?: string } }).error?.message
              : null;
          throw new Error(`whatsapp_send_failed:${response.status}${code ? `:${code}` : ""}${message ? `:${message}` : ""}`);
        }

        const messageId = payload?.messages?.[0]?.id;
        console.log("[worker][whatsapp-admin-cta] sent", {
          tenantId: input.tenantId,
          bookingId: input.bookingId,
          recipient: input.recipient,
          providerMessageId: messageId ?? null,
          mode: activeDeliveryMode
        });
        return {
          providerMessageId: String(messageId ?? `wa_sent_${Date.now()}`),
          waDeliveryMode: activeDeliveryMode,
          waTemplateName: activeDeliveryMode === "template" ? windowPolicy?.templateName ?? null : null,
          waTemplateLang: activeDeliveryMode === "template" ? windowPolicy?.templateLang ?? null : null,
          waWindowCheckedAt: windowPolicy?.checkedAt ?? null,
          waWindowOpen: windowPolicy?.windowOpen ?? null,
          waPolicyReason: windowPolicy?.reason ?? null
        };
      }
    }

    if (
      activeDeliveryMode === "template" &&
      (input.notificationType === "booking_reminder_24h" || input.notificationType === "booking_reminder_2h")
    ) {
      const response = await fetch(`https://graph.facebook.com/v21.0/${credentials.phoneNumberId}/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${credentials.accessToken}`
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: input.recipient,
          type: "template",
          template: {
            name: windowPolicy!.templateName,
            language: { code: windowPolicy!.templateLang }
          }
        })
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const code = payload && typeof payload === "object" ? (payload as { error?: { code?: number } }).error?.code : null;
        const message =
          payload && typeof payload === "object"
            ? (payload as { error?: { message?: string } }).error?.message
            : null;
        throw new Error(`whatsapp_send_failed:${response.status}${code ? `:${code}` : ""}${message ? `:${message}` : ""}`);
      }

      const messageId = payload?.messages?.[0]?.id;
      return {
        providerMessageId: String(messageId ?? `wa_sent_${Date.now()}`),
        waDeliveryMode: "template" as const,
        waTemplateName: windowPolicy?.templateName ?? null,
        waTemplateLang: windowPolicy?.templateLang ?? null,
        waWindowCheckedAt: windowPolicy?.checkedAt ?? null,
        waWindowOpen: windowPolicy?.windowOpen ?? null,
        waPolicyReason: windowPolicy?.reason ?? null
      };
    }

    const response = await fetch(`https://graph.facebook.com/v21.0/${credentials.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${credentials.accessToken}`
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: input.recipient,
        type: "text",
        text: { body: text }
      })
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const code = payload && typeof payload === "object" ? (payload as { error?: { code?: number } }).error?.code : null;
      const message =
        payload && typeof payload === "object"
          ? (payload as { error?: { message?: string } }).error?.message
          : null;
      throw new Error(`whatsapp_send_failed:${response.status}${code ? `:${code}` : ""}${message ? `:${message}` : ""}`);
    }

    const messageId = payload?.messages?.[0]?.id;
    return {
      providerMessageId: String(messageId ?? `wa_sent_${Date.now()}`),
      waDeliveryMode: "session" as const,
      waTemplateName: null,
      waTemplateLang: null,
      waWindowCheckedAt: windowPolicy?.checkedAt ?? null,
      waWindowOpen: windowPolicy?.windowOpen ?? null,
      waPolicyReason: windowPolicy?.reason ?? null
    };
  }

  // Email provider is not integrated yet; log-based baseline for delivery pipeline.
  console.log("[worker] email send simulated", { recipient: input.recipient, text });
  return { providerMessageId: `email_mock_${Date.now()}` };
}

async function runDeliverySweep() {
  if (!db || isDeliveryRunning) {
    return;
  }
  isDeliveryRunning = true;
  lastDeliveryError = null;
  let sent = 0;
  let failed = 0;

  try {
    const now = new Date();
    const queued = await db
      .select({
        id: notificationDeliveries.id,
        tenantId: notificationDeliveries.tenantId,
        bookingId: notificationDeliveries.bookingId,
        notificationType: notificationDeliveries.notificationType,
        channel: notificationDeliveries.channel,
        recipient: notificationDeliveries.recipient,
        attemptCount: notificationDeliveries.attemptCount,
        maxAttempts: notificationDeliveries.maxAttempts
      })
      .from(notificationDeliveries)
      .where(
        and(
          inArray(notificationDeliveries.status, ["queued", "failed"]),
          or(
            isNull(notificationDeliveries.nextAttemptAt),
            lte(notificationDeliveries.nextAttemptAt, now)
          )
        )
      )
      .orderBy(asc(notificationDeliveries.createdAt))
      .limit(100);

    for (const item of queued) {
      try {
        const deliveryResult = await sendByChannel({
          tenantId: item.tenantId,
          channel: item.channel,
          recipient: item.recipient,
          notificationType: item.notificationType,
          bookingId: item.bookingId
        });

        await db
          .update(notificationDeliveries)
          .set({
            status: "sent",
            providerMessageId: deliveryResult.providerMessageId,
            nextAttemptAt: null,
            deadLetteredAt: null,
            lastAttemptAt: new Date(),
            sentAt: new Date(),
            updatedAt: new Date(),
            errorCode: null,
            errorMessage: null,
            waDeliveryMode: deliveryResult.waDeliveryMode ?? null,
            waTemplateName: deliveryResult.waTemplateName ?? null,
            waTemplateLang: deliveryResult.waTemplateLang ?? null,
            waWindowCheckedAt: deliveryResult.waWindowCheckedAt ?? null,
            waWindowOpen: deliveryResult.waWindowOpen ?? null,
            waPolicyReason: deliveryResult.waPolicyReason ?? null
          })
          .where(eq(notificationDeliveries.id, item.id));
        sent += 1;
      } catch (error) {
        const nextAttemptCount = item.attemptCount + 1;
        const maxAttempts = Math.max(1, item.maxAttempts || deliveryMaxAttempts);
        const exhausted = nextAttemptCount >= maxAttempts;
        const backoffSeconds = computeBackoffSeconds(nextAttemptCount);
        const nextAttemptAt = new Date(Date.now() + backoffSeconds * 1000);

        await db
          .update(notificationDeliveries)
          .set({
            status: exhausted ? "dead_letter" : "failed",
            attemptCount: nextAttemptCount,
            maxAttempts,
            nextAttemptAt: exhausted ? null : nextAttemptAt,
            deadLetteredAt: exhausted ? new Date() : null,
            lastAttemptAt: new Date(),
            updatedAt: new Date(),
            errorCode: "delivery_failed",
            errorMessage: error instanceof Error ? error.message : "delivery_failed"
          })
          .where(eq(notificationDeliveries.id, item.id));
        failed += 1;
      }
    }

    lastDeliveryAt = new Date().toISOString();
    lastDeliveryStats = { sent, failed, processed: queued.length };
    console.log("[worker] delivery sweep completed", lastDeliveryStats);
  } catch (error) {
    lastDeliveryError = error instanceof Error ? error.message : "unknown_delivery_error";
    console.error("[worker] delivery sweep failed", error);
    await captureException({
      service: "worker",
      error,
      context: { phase: "delivery_sweep" }
    });
  } finally {
    isDeliveryRunning = false;
  }
}

async function runCleanupSweep() {
  if (!db || isCleanupRunning) {
    return;
  }

  isCleanupRunning = true;
  lastCleanupError = null;
  try {
    const now = new Date();
    const refreshResult = await db.delete(refreshTokens).where(lte(refreshTokens.expiresAt, now));
    const resetResult = await db
      .delete(passwordResetTokens)
      .where(lte(passwordResetTokens.expiresAt, now));
    const verifyResult = await db
      .delete(emailVerificationTokens)
      .where(lte(emailVerificationTokens.expiresAt, now));
    const idemResult = await db.delete(idempotencyKeys).where(lte(idempotencyKeys.expiresAt, now));
    const retentionCutoff = new Date(
      now.getTime() - Math.max(1, Math.trunc(unverifiedAccountRetentionDays)) * 24 * 60 * 60 * 1000
    );
    const staleTenantRows = await db.execute<{ id: string }>(sql`
      SELECT t.id
      FROM tenants t
      WHERE
        t.created_at < ${retentionCutoff}
        AND EXISTS (
          SELECT 1
          FROM users u
          WHERE u.tenant_id = t.id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM users verified
          WHERE verified.tenant_id = t.id
            AND verified.is_email_verified = TRUE
        )
    `);
    const staleTenantIds = staleTenantRows.rows.map((item) => item.id).filter(Boolean);
    const staleTenantDeleteResult =
      staleTenantIds.length > 0
        ? await db.delete(tenants).where(inArray(tenants.id, staleTenantIds))
        : { rowCount: 0 };

    lastCleanupAt = now.toISOString();
    lastCleanupStats = {
      refreshDeleted: refreshResult.rowCount ?? 0,
      resetDeleted: resetResult.rowCount ?? 0,
      verifyDeleted: verifyResult.rowCount ?? 0,
      idempotencyDeleted: idemResult.rowCount ?? 0,
      unverifiedTenantDeleted: staleTenantDeleteResult.rowCount ?? 0
    };
    console.log("[worker] cleanup sweep completed", lastCleanupStats);
  } catch (error) {
    lastCleanupError = error instanceof Error ? error.message : "cleanup_failed";
    console.error("[worker] cleanup sweep failed", error);
    await captureException({
      service: "worker",
      error,
      context: { phase: "cleanup_sweep" }
    });
  } finally {
    isCleanupRunning = false;
  }
}

const server = createServer((req, res) => {
  if (req.url === "/health" && req.method === "GET") {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        data: {
          status: "ok",
          service: "worker",
          reminder: {
            lastSweepAt,
            lastSweepError,
            stats: lastSweepStats
          },
          delivery: {
            lastDeliveryAt,
            lastDeliveryError,
            stats: lastDeliveryStats
          },
          cleanup: {
            lastCleanupAt,
            lastCleanupError,
            stats: lastCleanupStats
          }
        }
      })
    );
    return;
  }

  if (req.url === "/ready" && req.method === "GET") {
    const redisStatusPromise = pingRedis();
    const dbConfigured = Boolean(db);
    redisStatusPromise
      .then((redisStatus) => {
        const ready = dbConfigured && redisStatus !== "error";
        res.statusCode = ready ? 200 : 503;
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            data: {
              status: ready ? "ready" : "not_ready",
              service: "worker",
              checks: {
                db: dbConfigured ? "configured" : "missing_database_url",
                redis: redisStatus
              }
            }
          })
        );
      })
      .catch(() => {
        res.statusCode = 503;
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            data: {
              status: "not_ready",
              service: "worker",
              checks: {
                db: dbConfigured ? "configured" : "missing_database_url",
                redis: "error"
              }
            }
          })
        );
      });
    return;
  }

  if (req.method === "POST" && (req.url === "/run/reminders" || req.url === "/run/delivery" || req.url === "/run/cleanup")) {
    const secret = req.headers["x-worker-secret"];
    if (workerAdminSecret && secret !== workerAdminSecret) {
      res.statusCode = 403;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: { code: "AUTH_FORBIDDEN", message: "Invalid worker secret" } }));
      return;
    }

    if (req.url === "/run/reminders") {
      void runReminderSweep();
    }
    if (req.url === "/run/delivery") {
      void runDeliverySweep();
    }
    if (req.url === "/run/cleanup") {
      void runCleanupSweep();
    }

    res.statusCode = 202;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ data: { accepted: true, job: req.url.slice(5) } }));
    return;
  }

  res.statusCode = 404;
  res.end();
});

server.listen(port, () => {
  console.log(`[worker] listening on :${port}`);
});

setInterval(() => {
  console.log("[worker] heartbeat");
}, heartbeatIntervalMs);

setInterval(() => {
  void runReminderSweep();
}, reminderPollIntervalMs);

void runReminderSweep();

setInterval(() => {
  void runDeliverySweep();
}, deliveryPollIntervalMs);

void runDeliverySweep();

setInterval(() => {
  void runCleanupSweep();
}, cleanupPollIntervalMs);

void runCleanupSweep();
