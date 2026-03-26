#!/usr/bin/env node

const checks = [
  {
    name: "api health",
    url: process.env.SMOKE_API_HEALTH_URL ?? "https://api-production-9caa.up.railway.app/api/v1/health",
    expectedStatus: 200
  },
  {
    name: "api ready",
    url: process.env.SMOKE_API_READY_URL ?? "https://api-production-9caa.up.railway.app/api/v1/ready",
    expectedStatus: 200
  },
  {
    name: "bot health",
    url: process.env.SMOKE_BOT_HEALTH_URL ?? "https://bot-production-5177.up.railway.app/health",
    expectedStatus: 200
  },
  {
    name: "bot ready",
    url: process.env.SMOKE_BOT_READY_URL ?? "https://bot-production-5177.up.railway.app/ready",
    expectedStatus: 200
  },
  {
    name: "worker health",
    url: process.env.SMOKE_WORKER_HEALTH_URL ?? "https://worker-production-ef14.up.railway.app/health",
    expectedStatus: 200
  },
  {
    name: "worker ready",
    url: process.env.SMOKE_WORKER_READY_URL ?? "https://worker-production-ef14.up.railway.app/ready",
    expectedStatus: 200
  }
];

const maxLatencyMs = Number.parseInt(process.env.SMOKE_MAX_LATENCY_MS ?? "7000", 10);

async function runCheck(check) {
  const startedAt = Date.now();
  let response;
  try {
    response = await fetch(check.url, {
      method: "GET",
      headers: { "content-type": "application/json" }
    });
  } catch (error) {
    throw new Error(`${check.name} unreachable: ${error instanceof Error ? error.message : "fetch failed"}`);
  }

  const durationMs = Date.now() - startedAt;
  if (response.status !== check.expectedStatus) {
    throw new Error(`${check.name} expected ${check.expectedStatus}, got ${response.status} (${check.url})`);
  }

  if (durationMs > maxLatencyMs) {
    throw new Error(`${check.name} latency too high: ${durationMs}ms > ${maxLatencyMs}ms`);
  }

  console.log(`[observability-smoke] ${check.name} ok (${response.status}) ${durationMs}ms`);
}

for (const check of checks) {
  await runCheck(check);
}

console.log("[observability-smoke] all checks passed");
