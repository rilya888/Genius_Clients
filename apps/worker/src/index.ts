import { createServer } from "node:http";
import { and, asc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import {
  bookings,
  createDbClient,
  emailVerificationTokens,
  idempotencyKeys,
  notificationDeliveries,
  passwordResetTokens,
  refreshTokens
} from "@genius/db";
import { captureException } from "@genius/shared";
import Redis from "ioredis";

const heartbeatIntervalMs = Number(process.env.WORKER_HEARTBEAT_MS ?? 15000);
const reminderPollIntervalMs = Number(process.env.WORKER_REMINDER_POLL_MS ?? 60000);
const deliveryPollIntervalMs = Number(process.env.WORKER_DELIVERY_POLL_MS ?? 30000);
const cleanupPollIntervalMs = Number(process.env.WORKER_CLEANUP_POLL_MS ?? 600000);
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
} = {
  refreshDeleted: 0,
  resetDeleted: 0,
  verifyDeleted: 0,
  idempotencyDeleted: 0
};

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

async function sendByChannel(input: {
  channel: string;
  recipient: string;
  notificationType: string;
  bookingId: string | null;
}) {
  const bookingCode = input.bookingId ?? "n/a";
  const textByType: Record<string, string> = {
    booking_confirmed_client: `Booking confirmed. Your booking code is ${bookingCode}.`,
    booking_cancelled: `Booking cancelled. Booking code ${bookingCode}.`,
    booking_reminder_24h: `Reminder: your booking is in 24 hours. Code: ${bookingCode}.`,
    booking_reminder_2h: `Reminder: your booking is in 2 hours. Code: ${bookingCode}.`
  };
  const text = textByType[input.notificationType] ?? `[${input.notificationType}] booking=${bookingCode}`;

  if (input.channel === "telegram") {
    return sendTelegramMessage({ chatId: input.recipient, text });
  }

  if (input.channel === "whatsapp") {
    if (!waPhoneNumberId || !waAccessToken) {
      return `wa_mock_${Date.now()}`;
    }

    const response = await fetch(`https://graph.facebook.com/v21.0/${waPhoneNumberId}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${waAccessToken}`
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
      throw new Error(`whatsapp_send_failed:${response.status}`);
    }

    const messageId = payload?.messages?.[0]?.id;
    return String(messageId ?? `wa_sent_${Date.now()}`);
  }

  // Email provider is not integrated yet; log-based baseline for delivery pipeline.
  console.log("[worker] email send simulated", { recipient: input.recipient, text });
  return `email_mock_${Date.now()}`;
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
        const providerMessageId = await sendByChannel({
          channel: item.channel,
          recipient: item.recipient,
          notificationType: item.notificationType,
          bookingId: item.bookingId
        });

        await db
          .update(notificationDeliveries)
          .set({
            status: "sent",
            providerMessageId,
            nextAttemptAt: null,
            deadLetteredAt: null,
            lastAttemptAt: new Date(),
            sentAt: new Date(),
            updatedAt: new Date(),
            errorCode: null,
            errorMessage: null
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

    lastCleanupAt = now.toISOString();
    lastCleanupStats = {
      refreshDeleted: refreshResult.rowCount ?? 0,
      resetDeleted: resetResult.rowCount ?? 0,
      verifyDeleted: verifyResult.rowCount ?? 0,
      idempotencyDeleted: idemResult.rowCount ?? 0
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
