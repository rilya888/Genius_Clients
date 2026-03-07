#!/usr/bin/env node

const service = process.argv[2] ?? "all";

const groups = {
  api: ["DATABASE_URL", "INTERNAL_API_SECRET", "AUTH_TOKEN_SECRET"],
  web: ["APP_URL", "API_URL", "SESSION_COOKIE_DOMAIN"],
  bot: ["API_URL", "INTERNAL_API_SECRET"],
  worker: ["DATABASE_URL", "WORKER_ADMIN_SECRET"],
  integrations: ["OPENAI_API_KEY", "WA_VERIFY_TOKEN", "TG_BOT_TOKEN", "STRIPE_WEBHOOK_SECRET"],
  observability: ["SENTRY_DSN"]
};

const selected =
  service === "all"
    ? Object.keys(groups)
    : service.split(",").map((item) => item.trim()).filter(Boolean);

let hasMissing = false;
for (const key of selected) {
  const vars = groups[key];
  if (!vars) {
    console.error(`Unknown group: ${key}`);
    process.exitCode = 1;
    continue;
  }

  const missing = vars.filter((name) => !(process.env[name] ?? "").trim());
  if (missing.length > 0) {
    hasMissing = true;
    console.error(`[env] ${key}: missing ${missing.join(", ")}`);
  } else {
    console.log(`[env] ${key}: ok`);
  }
}

if (hasMissing) {
  process.exit(1);
}

console.log("[env] all selected groups are configured");
