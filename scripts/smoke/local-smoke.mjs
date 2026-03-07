#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const checks = [
  { name: "web", url: process.env.SMOKE_WEB_URL ?? "http://localhost:3000/api/health" },
  { name: "api", url: process.env.SMOKE_API_URL ?? "http://localhost:3001/api/v1/health" },
  { name: "bot", url: process.env.SMOKE_BOT_URL ?? "http://localhost:3002/health" },
  { name: "worker", url: process.env.SMOKE_WORKER_URL ?? "http://localhost:3003/health" }
];

let failed = 0;
for (const check of checks) {
  try {
    const probe = spawnSync("curl", ["-sS", "-o", "/dev/null", "-w", "%{http_code}", check.url], {
      encoding: "utf-8"
    });
    if (probe.status !== 0) {
      failed += 1;
      console.error(`[smoke] ${check.name} request error: ${check.url}`);
      console.error((probe.stderr || "").trim() || `curl exit ${probe.status}`);
      continue;
    }
    const statusCode = Number(probe.stdout.trim());
    if (!Number.isFinite(statusCode) || statusCode < 200 || statusCode >= 400) {
      failed += 1;
      console.error(`[smoke] ${check.name} failed with status ${statusCode}: ${check.url}`);
      continue;
    }
    console.log(`[smoke] ${check.name} ok (${statusCode}): ${check.url}`);
  } catch (error) {
    failed += 1;
    console.error(`[smoke] ${check.name} request error: ${check.url}`);
    console.error(error instanceof Error ? error.message : String(error));
  }
}

if (failed > 0) {
  console.error(`[smoke] failed checks: ${failed}`);
  process.exit(1);
}

console.log("[smoke] all checks passed");
