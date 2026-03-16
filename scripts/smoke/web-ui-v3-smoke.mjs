#!/usr/bin/env node

const baseUrl = process.argv[2] || process.env.APP_URL || "https://web-production-6f97.up.railway.app";

/**
 * Fetches a page and returns normalized text for marker checks.
 */
async function fetchHtml(path) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "GET",
    headers: { "user-agent": "gc-ui-v3-smoke" }
  });
  const text = await response.text();
  return { ok: response.ok, status: response.status, text };
}

function assertContains(haystack, marker, label) {
  if (!haystack.includes(marker)) {
    throw new Error(`[${label}] Missing marker: ${marker}`);
  }
}

async function run() {
  const home = await fetchHtml("/");
  if (!home.ok) {
    throw new Error(`[home] HTTP ${home.status}`);
  }

  assertContains(home.text, "Convert more visitors into booked appointments", "home");
  assertContains(home.text, "Live Product Snapshot", "home");
  assertContains(home.text, "Plans built for growth", "home");

  const booking = await fetchHtml("/public/book");
  if (!booking.ok) {
    throw new Error(`[public-book] HTTP ${booking.status}`);
  }

  assertContains(booking.text, "Booking progress", "public-book");
  assertContains(booking.text, "Booking policy", "public-book");
  assertContains(booking.text, "Slots are validated in real time", "public-book");

  const auth = await fetchHtml("/auth");
  if (!auth.ok) {
    throw new Error(`[auth] HTTP ${auth.status}`);
  }
  assertContains(auth.text, "Checking session", "auth");

  console.log(JSON.stringify({ ok: true, baseUrl }, null, 2));
}

run().catch((error) => {
  console.error(JSON.stringify({ ok: false, baseUrl, error: error.message }, null, 2));
  process.exit(1);
});
