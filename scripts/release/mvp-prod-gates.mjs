#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const apiUrl = process.env.SMOKE_API_URL ?? "https://api-production-9caa.up.railway.app";
const tenantSlug = process.env.SMOKE_TENANT_SLUG ?? "alex-salon";
const includeMutatingSuperAdmin = process.env.SMOKE_INCLUDE_MUTATING_SUPER_ADMIN === "1";
const superAdminSecret = process.env.SMOKE_SUPER_ADMIN_SECRET ?? process.env.SUPER_ADMIN_LOGIN_SECRET ?? "";

function runStep(name, command, args, extraEnv = {}) {
  console.log(`\n[mvp-prod-gates] step: ${name}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: {
      ...process.env,
      SMOKE_TENANT_SLUG: tenantSlug,
      ...extraEnv
    }
  });
  if (typeof result.status === "number" && result.status !== 0) {
    throw new Error(`${name} failed with exit code ${result.status}`);
  }
  if (result.error) {
    throw result.error;
  }
}

if (!superAdminSecret.trim()) {
  throw new Error("SMOKE_SUPER_ADMIN_SECRET (or SUPER_ADMIN_LOGIN_SECRET) is required for mvp-prod-gates");
}

runStep("production health", "pnpm", ["-s", "smoke:production"]);
runStep("observability", "pnpm", ["-s", "smoke:observability"]);
runStep("spa public contract", "pnpm", ["-s", "smoke:spa:public"], {
  SMOKE_API_URL: apiUrl
});
runStep("spa auth-admin contract", "pnpm", ["-s", "smoke:spa:auth-admin"], {
  SMOKE_API_URL: apiUrl,
  SMOKE_AUTH_AUTOREGISTER: "1"
});
runStep("tenant host resolution", "pnpm", ["-s", "smoke:tenant-host"], {
  SMOKE_API_BASE_URL: apiUrl,
  SMOKE_TENANT_AUTOREGISTER: "1"
});
runStep("tenant host security", "pnpm", ["-s", "smoke:tenant-host:security"], {
  SMOKE_API_BASE_URL: apiUrl
});
runStep("super-admin security", "pnpm", ["-s", "smoke:super-admin:security"], {
  SMOKE_API_URL: apiUrl,
  SMOKE_SUPER_ADMIN_SECRET: superAdminSecret
});

if (includeMutatingSuperAdmin) {
  runStep("super-admin flow (mutating)", "pnpm", ["-s", "smoke:super-admin:flow"], {
    SMOKE_API_URL: apiUrl,
    SMOKE_SUPER_ADMIN_SECRET: superAdminSecret,
    SMOKE_SUPER_ADMIN_MUTATION: "1"
  });
}

console.log("\n[mvp-prod-gates] all checks passed");
