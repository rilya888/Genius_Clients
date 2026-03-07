import { appError } from "../lib/http";
import { createHmac, timingSafeEqual } from "node:crypto";

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

export function assertWhatsAppSignature(signature: string | undefined, rawBody: string) {
  if (!signature) {
    throw appError("AUTH_FORBIDDEN", { reason: "missing x-hub-signature-256" });
  }

  if (!signature.startsWith("sha256=")) {
    throw appError("AUTH_FORBIDDEN", { reason: "invalid whatsapp signature format" });
  }

  const secret = process.env.META_APP_SECRET ?? process.env.WA_WEBHOOK_SECRET;
  if (!secret) {
    return;
  }

  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  if (!safeEqual(signature, expected)) {
    throw appError("AUTH_FORBIDDEN", { reason: "invalid whatsapp signature" });
  }
}

export function assertTelegramSecret(secret: string | undefined) {
  if (!secret) {
    throw appError("AUTH_FORBIDDEN", { reason: "missing x-telegram-bot-api-secret-token" });
  }

  const expected = process.env.TG_WEBHOOK_SECRET_TOKEN;
  if (expected && secret !== expected) {
    throw appError("AUTH_FORBIDDEN", { reason: "invalid telegram webhook secret" });
  }
}

export function assertStripeSignature(signature: string | undefined, rawBody: string) {
  if (!signature) {
    throw appError("AUTH_FORBIDDEN", { reason: "missing stripe-signature" });
  }

  if (!signature.includes("v1=")) {
    throw appError("AUTH_FORBIDDEN", { reason: "invalid stripe signature format" });
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return;
  }

  const parts = signature.split(",").map((part) => part.trim());
  const timestampPart = parts.find((part) => part.startsWith("t="));
  const v1Part = parts.find((part) => part.startsWith("v1="));

  if (!timestampPart || !v1Part) {
    throw appError("AUTH_FORBIDDEN", { reason: "invalid stripe signature structure" });
  }

  const timestamp = timestampPart.slice(2);
  const provided = v1Part.slice(3);
  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = createHmac("sha256", secret).update(signedPayload).digest("hex");

  if (!safeEqual(provided, expected)) {
    throw appError("AUTH_FORBIDDEN", { reason: "invalid stripe signature" });
  }
}
