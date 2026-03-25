import test from "node:test";
import assert from "node:assert/strict";

import { createBookingActionToken, verifyBookingActionToken } from "./action-token";

test("verifyBookingActionToken accepts valid admin_confirm token", () => {
  const now = 1_700_000_000;
  const token = createBookingActionToken(
    {
      action: "admin_confirm",
      bookingId: "booking_123",
      phoneE164: "+393334445556",
      expiresAtUnix: now + 300
    },
    "secret_123"
  );

  const result = verifyBookingActionToken(token, "secret_123", now);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.payload.action, "admin_confirm");
    assert.equal(result.payload.bookingId, "booking_123");
  }
});

test("verifyBookingActionToken returns token_expired for expired token", () => {
  const now = 1_700_000_000;
  const token = createBookingActionToken(
    {
      action: "admin_reject",
      bookingId: "booking_456",
      phoneE164: "+393334445556",
      expiresAtUnix: now - 10
    },
    "secret_456"
  );

  const result = verifyBookingActionToken(token, "secret_456", now);
  assert.deepEqual(result, { ok: false, reason: "token_expired" });
});

