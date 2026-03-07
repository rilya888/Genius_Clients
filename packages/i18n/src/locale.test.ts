import test from "node:test";
import assert from "node:assert/strict";
import { isSupportedLocale, resolveLocale } from "./locale";

test("isSupportedLocale validates known locales", () => {
  assert.equal(isSupportedLocale("it"), true);
  assert.equal(isSupportedLocale("en"), true);
  assert.equal(isSupportedLocale("de"), false);
});

test("resolveLocale picks requested first", () => {
  assert.equal(resolveLocale({ requested: "it", tenantDefault: "en", fallback: "en" }), "it");
});

test("resolveLocale falls back to tenant default", () => {
  assert.equal(resolveLocale({ requested: "fr", tenantDefault: "en", fallback: "it" }), "en");
});

test("resolveLocale falls back to explicit fallback then en", () => {
  assert.equal(resolveLocale({ requested: "fr", tenantDefault: "de", fallback: "it" }), "it");
  assert.equal(resolveLocale({ requested: "fr", tenantDefault: "de" }), "en");
});
