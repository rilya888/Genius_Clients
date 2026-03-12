import { Hono } from "hono";
import type { ApiAppEnv } from "../../lib/hono-env";
import { WebhookService } from "../../services";
import {
  assertStripeSignature,
  assertTelegramSecret,
  assertWhatsAppSignature
} from "../../middleware/webhook-signature";
import { appError } from "../../lib/http";

const webhookService = new WebhookService();

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function extractWhatsAppEventId(payload: unknown, fallback: string): string {
  const root = asRecord(payload);
  const entry = Array.isArray(root.entry) ? root.entry[0] : undefined;
  const entryObj = asRecord(entry);
  const changes = Array.isArray(entryObj.changes) ? entryObj.changes[0] : undefined;
  const value = asRecord(asRecord(changes).value);
  const firstMessage = Array.isArray(value.messages) ? asRecord(value.messages[0]) : {};
  const firstStatus = Array.isArray(value.statuses) ? asRecord(value.statuses[0]) : {};
  return String(firstMessage.id ?? firstStatus.id ?? fallback);
}

function extractWhatsAppEventType(payload: unknown): string {
  const root = asRecord(payload);
  const entry = Array.isArray(root.entry) ? root.entry[0] : undefined;
  const entryObj = asRecord(entry);
  const changes = Array.isArray(entryObj.changes) ? entryObj.changes[0] : undefined;
  return String(asRecord(changes).field ?? "unknown");
}

function parseJsonOrThrow(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    throw appError("VALIDATION_ERROR", { reason: "invalid_json_body" });
  }
}

export const webhookRoutes = new Hono<ApiAppEnv>()
  .get("/whatsapp", (c) => {
    const mode = c.req.query("hub.mode");
    const token = c.req.query("hub.verify_token");
    const challenge = c.req.query("hub.challenge");
    const expected = process.env.WA_VERIFY_TOKEN ?? process.env.WA_WEBHOOK_SECRET;

    if (mode === "subscribe" && token && expected && token === expected && challenge) {
      return c.text(challenge, 200);
    }

    throw appError("AUTH_FORBIDDEN", { reason: "invalid_whatsapp_webhook_verification" });
  })
  .post("/whatsapp", async (c) => {
    const rawBody = await c.req.text();
    assertWhatsAppSignature(c.req.header("x-hub-signature-256"), rawBody);
    const payload = parseJsonOrThrow(rawBody);
    const fallback = webhookService.buildFallbackEventId(payload);
    const providerEventId = extractWhatsAppEventId(payload, fallback);
    const eventType = extractWhatsAppEventType(payload);

    return c.json({
      data: await webhookService.handleWhatsApp({
        providerEventId,
        eventType,
        payloadJson: payload
      })
    });
  })
  .post("/telegram", async (c) => {
    assertTelegramSecret(c.req.header("x-telegram-bot-api-secret-token"));
    const payload = await c.req.json<{ update_id?: number; message?: unknown; callback_query?: unknown }>();
    const providerEventId = String(payload.update_id ?? webhookService.buildFallbackEventId(payload));
    const eventType = payload.message ? "message" : payload.callback_query ? "callback_query" : "unknown";

    return c.json({
      data: await webhookService.handleTelegram({
        providerEventId,
        eventType,
        payloadJson: payload
      })
    });
  })
  .post("/stripe", async (c) => {
    const rawBody = await c.req.text();
    assertStripeSignature(c.req.header("stripe-signature"), rawBody);
    const payload = parseJsonOrThrow(rawBody) as { id?: string; type?: string };
    const providerEventId = payload.id ?? webhookService.buildFallbackEventId(payload);
    const eventType = payload.type ?? "unknown";

    return c.json({
      data: await webhookService.handleStripe({
        providerEventId,
        eventType,
        payloadJson: payload
      })
    });
  });
