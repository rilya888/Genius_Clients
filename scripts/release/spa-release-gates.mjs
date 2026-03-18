#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const steps = [
  ["pnpm", ["--filter", "@genius/web-vite", "run", "typecheck"]],
  ["pnpm", ["--filter", "@genius/web-vite", "run", "build"]],
  ["pnpm", ["smoke:web-vite:api-target"]],
  ["pnpm", ["smoke:web-vite:journey"]]
];

const hasAuthSmokeCreds = Boolean(process.env.SMOKE_AUTH_EMAIL && process.env.SMOKE_AUTH_PASSWORD);
const requireAuthSmoke = process.env.RELEASE_REQUIRE_AUTH_SMOKE === "1";
if (hasAuthSmokeCreds) {
  steps.push(["pnpm", ["smoke:spa:auth-admin"]]);
} else if (requireAuthSmoke) {
  console.error(
    "[spa-release-gates] auth-admin smoke is required, but SMOKE_AUTH_EMAIL/SMOKE_AUTH_PASSWORD are missing"
  );
  process.exit(1);
} else {
  console.log("[spa-release-gates] skipping auth-admin smoke (missing SMOKE_AUTH_EMAIL/SMOKE_AUTH_PASSWORD)");
}

if (process.env.SMOKE_TENANT_SLUG || process.env.VITE_TENANT_SLUG) {
  steps.push(["pnpm", ["smoke:spa:public"]]);
}

for (const [command, args] of steps) {
  console.log(`[spa-release-gates] running: ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { stdio: "inherit", shell: false });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("[spa-release-gates] all gates passed");
