import { createHmac, timingSafeEqual } from "node:crypto";

export type BookingActionType =
  | "client_confirm"
  | "client_cancel_init"
  | "client_cancel_confirm"
  | "client_reschedule"
  | "flow_confirm_booking"
  | "flow_confirm_cancel"
  | "admin_confirm"
  | "admin_cancel";

export type BookingActionTokenPayload = {
  action: BookingActionType;
  bookingId: string;
  phoneE164: string;
  expiresAtUnix: number;
};

function base64UrlFromBuffer(value: Buffer) {
  return value
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function toSignableString(payload: BookingActionTokenPayload) {
  return ["v1", payload.action, payload.bookingId, payload.phoneE164, String(payload.expiresAtUnix)].join("|");
}

function signPayload(payload: BookingActionTokenPayload, secret: string) {
  const raw = createHmac("sha256", secret).update(toSignableString(payload)).digest();
  return base64UrlFromBuffer(raw).slice(0, 24);
}

export function createBookingActionToken(payload: BookingActionTokenPayload, secret: string) {
  const signature = signPayload(payload, secret);
  return `v1.${payload.action}.${payload.bookingId}.${encodeURIComponent(payload.phoneE164)}.${payload.expiresAtUnix}.${signature}`;
}

function safeEquals(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

function isBookingActionType(value: string): value is BookingActionType {
  return [
    "client_confirm",
    "client_cancel_init",
    "client_cancel_confirm",
    "client_reschedule",
    "flow_confirm_booking",
    "flow_confirm_cancel",
    "admin_confirm",
    "admin_cancel"
  ].includes(value);
}

export function verifyBookingActionToken(token: string, secret: string, nowUnix = Math.floor(Date.now() / 1000)) {
  const parts = token.split(".");
  if (parts.length !== 6 || parts[0] !== "v1") {
    return { ok: false as const, reason: "token_format_invalid" as const };
  }

  const actionRaw = parts[1] ?? "";
  const bookingId = parts[2] ?? "";
  const phoneRaw = parts[3] ?? "";
  const expiresRaw = parts[4] ?? "";
  const signature = parts[5] ?? "";
  if (!isBookingActionType(actionRaw)) {
    return { ok: false as const, reason: "token_action_invalid" as const };
  }

  const expiresAtUnix = Number(expiresRaw);
  if (!Number.isFinite(expiresAtUnix) || expiresAtUnix <= 0) {
    return { ok: false as const, reason: "token_exp_invalid" as const };
  }

  const phoneE164 = decodeURIComponent(phoneRaw);
  const payload: BookingActionTokenPayload = {
    action: actionRaw,
    bookingId,
    phoneE164,
    expiresAtUnix
  };

  const expected = signPayload(payload, secret);
  if (!safeEquals(signature, expected)) {
    return { ok: false as const, reason: "token_signature_invalid" as const };
  }
  if (payload.expiresAtUnix < nowUnix) {
    return { ok: false as const, reason: "token_expired" as const };
  }

  return {
    ok: true as const,
    payload
  };
}
