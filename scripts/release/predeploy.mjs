#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const steps = [
  ["pnpm", ["lint"]],
  ["pnpm", ["typecheck"]],
  ["pnpm", ["i18n:check"]],
  ["pnpm", ["test"]],
  ["pnpm", ["build"]]
];

for (const [command, args] of steps) {
  console.log(`[predeploy] running: ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { stdio: "inherit", shell: false });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("[predeploy] quality gates passed");
