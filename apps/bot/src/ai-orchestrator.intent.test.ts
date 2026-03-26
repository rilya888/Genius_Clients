import test from "node:test";
import assert from "node:assert/strict";
import { detectFastPathIntent, detectTransportFallbackIntent } from "./ai-orchestrator";

test("detectFastPathIntent maps change booking to reschedule", () => {
  const parsed = detectFastPathIntent("i want to change my booking", "en");
  assert.ok(parsed);
  assert.equal(parsed.intent, "reschedule_booking");
  assert.equal(parsed.confidence, "high");
});

test("detectFastPathIntent keeps booking list for list-like query", () => {
  const parsed = detectFastPathIntent("show my bookings", "en");
  assert.ok(parsed);
  assert.equal(parsed.intent, "booking_list");
});

test("detectTransportFallbackIntent prioritizes reschedule over booking list", () => {
  const parsed = detectTransportFallbackIntent("can I move my appointment", "en");
  assert.ok(parsed);
  assert.equal(parsed.intent, "reschedule_booking");
  assert.equal(parsed.intentOverrideReason, "reschedule_signal");
});
