#!/usr/bin/env node

const API_BASE_URL = process.env.SMOKE_API_URL ?? process.env.API_URL ?? process.env.VITE_API_URL ?? "";
const TENANT_SLUG = process.env.SMOKE_TENANT_SLUG ?? process.env.VITE_TENANT_SLUG ?? "demo";

if (!API_BASE_URL) {
  console.log("[web-vite-api-target-smoke] skipped: no API URL in SMOKE_API_URL/API_URL/VITE_API_URL");
  process.exit(0);
}

let parsed;
try {
  parsed = new URL(API_BASE_URL);
} catch {
  throw new Error(`[web-vite-api-target-smoke] invalid API URL: ${API_BASE_URL}`);
}

const isLocalhost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
if (isLocalhost && process.env.SMOKE_ALLOW_LOCALHOST !== "1") {
  throw new Error(
    `[web-vite-api-target-smoke] API target points to localhost (${API_BASE_URL}). Set SMOKE_ALLOW_LOCALHOST=1 only for local runs.`
  );
}

const healthUrl = new URL("/api/v1/health", parsed).toString();
const response = await fetch(healthUrl, {
  method: "GET",
  headers: {
    "content-type": "application/json",
    "x-internal-tenant-slug": TENANT_SLUG
  }
}).catch((error) => {
  throw new Error(`[web-vite-api-target-smoke] cannot reach ${healthUrl}: ${error instanceof Error ? error.message : "fetch failed"}`);
});

if (!response.ok) {
  const payload = await response.json().catch(() => null);
  const message = payload?.error?.message ?? `HTTP_${response.status}`;
  const requestId = response.headers.get("x-request-id");
  throw new Error(`[web-vite-api-target-smoke] health check failed: ${message}${requestId ? ` (requestId: ${requestId})` : ""}`);
}

console.log(`[web-vite-api-target-smoke] OK (api=${parsed.origin})`);
