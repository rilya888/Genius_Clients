#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const checks = [
  {
    name: "web",
    url:
      process.env.SMOKE_WEB_URL ??
      "https://web-production-6f97.up.railway.app/api/health"
  },
  {
    name: "api",
    url:
      process.env.SMOKE_API_URL ??
      "https://api-production-9caa.up.railway.app/api/v1/health"
  },
  {
    name: "bot",
    url: process.env.SMOKE_BOT_URL ?? "https://bot-production-5177.up.railway.app/health"
  },
  {
    name: "worker",
    url:
      process.env.SMOKE_WORKER_URL ??
      "https://worker-production-ef14.up.railway.app/health"
  }
];

let failed = 0;
for (const check of checks) {
  const probe = spawnSync("curl", ["-sS", "-o", "/dev/null", "-w", "%{http_code}", check.url], {
    encoding: "utf-8"
  });

  if (probe.status !== 0) {
    failed += 1;
    console.error(`[smoke:prod] ${check.name} request error: ${check.url}`);
    console.error((probe.stderr || "").trim() || `curl exit ${probe.status}`);
    continue;
  }

  const statusCode = Number(probe.stdout.trim());
  if (!Number.isFinite(statusCode) || statusCode < 200 || statusCode >= 400) {
    failed += 1;
    console.error(`[smoke:prod] ${check.name} failed with status ${statusCode}: ${check.url}`);
    continue;
  }

  console.log(`[smoke:prod] ${check.name} ok (${statusCode}): ${check.url}`);
}

if (failed > 0) {
  console.error(`[smoke:prod] failed checks: ${failed}`);
  process.exit(1);
}

console.log("[smoke:prod] all checks passed");
