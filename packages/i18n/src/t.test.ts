import test from "node:test";
import assert from "node:assert/strict";
import { t } from "./t";

test("translation returns requested locale key", () => {
  const value = t("auth.login", { locale: "en" });
  assert.equal(value, "Login");
});

test("translation falls back to tenant default locale", () => {
  const value = t("public.booking.findSlots", {
    locale: "en",
    tenantDefaultLocale: "it"
  });
  assert.ok(typeof value === "string");
  assert.notEqual(value.length, 0);
});

test("translation interpolates named params", () => {
  const value = t("public.booking.created", {
    locale: "en",
    params: { bookingId: "BKG-001" }
  });
  assert.ok(value.includes("BKG-001"));
});
