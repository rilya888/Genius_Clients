import test from "node:test";
import assert from "node:assert/strict";

import { assertE164, assertEmail, assertPassword } from "./validation";

test("assertEmail validates email format", () => {
  assert.doesNotThrow(() => assertEmail("demo@example.com"));
  assert.throws(() => assertEmail("invalid-email"), /invalid email/i);
});

test("assertPassword enforces minimum length", () => {
  assert.doesNotThrow(() => assertPassword("password123"));
  assert.throws(() => assertPassword("short"), /at least 8/i);
});

test("assertE164 validates E.164 phone format", () => {
  assert.doesNotThrow(() => assertE164("+393331234567"));
  assert.throws(() => assertE164("3331234567"), /e\.164/i);
});
