#!/usr/bin/env node

const API_BASE_URL = process.env.SMOKE_API_URL ?? process.env.API_URL ?? process.env.VITE_API_URL ?? "http://localhost:8787";
const TENANT_SLUG = process.env.SMOKE_TENANT_SLUG ?? process.env.VITE_TENANT_SLUG ?? "demo";
const EMAIL = process.env.SMOKE_AUTH_EMAIL;
const PASSWORD = process.env.SMOKE_AUTH_PASSWORD;

if (!EMAIL || !PASSWORD) {
  throw new Error("SMOKE_AUTH_EMAIL and SMOKE_AUTH_PASSWORD are required");
}

function url(path) {
  return new URL(path, API_BASE_URL).toString();
}

async function requestJson(path, init = {}) {
  const headers = new Headers(init.headers ?? {});
  headers.set("content-type", "application/json");
  headers.set("x-internal-tenant-slug", TENANT_SLUG);
  const method = (init.method ?? "GET").toUpperCase();
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && !headers.has("x-csrf-token")) {
    headers.set("x-csrf-token", "smoke-csrf");
  }
  let response;
  try {
    response = await fetch(url(path), { ...init, headers });
  } catch (error) {
    throw new Error(`Cannot reach API at ${API_BASE_URL}: ${error instanceof Error ? error.message : "fetch failed"}`);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message ?? `HTTP_${response.status}`;
    const requestId = response.headers.get("x-request-id");
    throw new Error(`${message}${requestId ? ` (requestId: ${requestId})` : ""}`);
  }
  return payload;
}

const loginPayload = await requestJson("/api/v1/auth/login", {
  method: "POST",
  body: JSON.stringify({ email: EMAIL, password: PASSWORD })
});

const accessToken = loginPayload?.data?.accessToken ?? loginPayload?.data?.session?.accessToken;
const refreshToken = loginPayload?.data?.refreshToken ?? loginPayload?.data?.session?.refreshToken;
if (!accessToken || !refreshToken) {
  throw new Error("login response does not contain session accessToken/refreshToken");
}

await requestJson("/api/v1/auth/me", {
  method: "GET",
  headers: { authorization: `Bearer ${accessToken}` }
});

const servicesPayload = await requestJson("/api/v1/admin/services", {
  method: "GET",
  headers: { authorization: `Bearer ${accessToken}` }
});

await requestJson("/api/v1/auth/refresh", {
  method: "POST",
  body: JSON.stringify({ refreshToken })
});

console.log(
  `spa auth->admin contract: OK (tenant=${TENANT_SLUG}, services=${servicesPayload?.data?.items?.length ?? 0})`
);
