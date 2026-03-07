import test from "node:test";
import assert from "node:assert/strict";

import { assertValidSlug, normalizeSlug } from "./slug";

test("normalizeSlug sanitizes and normalizes user input", () => {
  assert.equal(normalizeSlug("  My Salon!!!  "), "my-salon");
  assert.equal(normalizeSlug("A__B__C"), "a-b-c");
});

test("assertValidSlug accepts valid values", () => {
  assert.doesNotThrow(() => assertValidSlug("my-salon-1"));
});

test("assertValidSlug rejects invalid values", () => {
  assert.throws(() => assertValidSlug("ab"), /length/i);
  assert.throws(() => assertValidSlug("admin"), /reserved/i);
  assert.throws(() => assertValidSlug("hello_world"), /contain only/i);
});
