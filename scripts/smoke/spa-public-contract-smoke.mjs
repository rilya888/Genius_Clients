#!/usr/bin/env node

const API_BASE_URL = process.env.SMOKE_API_URL ?? process.env.API_URL ?? process.env.VITE_API_URL ?? "http://localhost:8787";
const TENANT_SLUG = process.env.SMOKE_TENANT_SLUG ?? process.env.VITE_TENANT_SLUG ?? "demo";
const LOCALE = process.env.SMOKE_PUBLIC_LOCALE ?? "en";

function url(path, query = {}) {
  const target = new URL(path, API_BASE_URL);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    target.searchParams.set(key, String(value));
  }
  return target.toString();
}

async function requestJson(path, query = {}) {
  let response;
  try {
    response = await fetch(url(path, query), {
      method: "GET",
      headers: {
        "content-type": "application/json",
        "x-internal-tenant-slug": TENANT_SLUG
      }
    });
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

const servicesPayload = await requestJson("/api/v1/public/services", { locale: LOCALE });
const services = servicesPayload?.data?.items ?? [];

const mastersPayload = await requestJson("/api/v1/public/masters", {
  locale: LOCALE,
  serviceId: services[0]?.id
});
const masters = mastersPayload?.data?.items ?? [];

let slots = [];
if (services[0]?.id) {
  const date = process.env.SMOKE_PUBLIC_DATE ?? new Date().toISOString().slice(0, 10);
  const slotsPayload = await requestJson("/api/v1/public/slots", {
    serviceId: services[0].id,
    date,
    masterId: masters[0]?.id
  });
  slots = slotsPayload?.data?.items ?? [];
}

console.log(`spa public contract: OK (tenant=${TENANT_SLUG}, services=${services.length}, masters=${masters.length}, slots=${slots.length})`);
