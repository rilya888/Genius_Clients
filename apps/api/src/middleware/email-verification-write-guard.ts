import type { Context, Next } from "hono";
import type { ApiAppEnv } from "../lib/hono-env";
import { appError } from "../lib/http";
import { getApiEnv } from "../lib/env";
import { SuperAdminRuntimeSettingsRepository } from "../repositories/super-admin/runtime-settings-repository";

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const runtimeSettingsRepository = new SuperAdminRuntimeSettingsRepository();

let cachedVerificationRequired: { value: boolean; expiresAt: number } | null = null;
const VERIFICATION_SETTING_CACHE_TTL_MS = 15_000;

async function isEmailVerificationRequiredForWrites() {
  const now = Date.now();
  if (cachedVerificationRequired && cachedVerificationRequired.expiresAt > now) {
    return cachedVerificationRequired.value;
  }

  const envDefault = getApiEnv().authEmailVerificationRequired;
  const runtime = await runtimeSettingsRepository.getAuthEmailVerificationRequired();
  const value = runtime.source === "runtime" && runtime.value !== null ? runtime.value : envDefault;
  cachedVerificationRequired = {
    value,
    expiresAt: now + VERIFICATION_SETTING_CACHE_TTL_MS
  };
  return value;
}

export async function emailVerificationWriteGuardMiddleware(c: Context<ApiAppEnv>, next: Next) {
  if (!STATE_CHANGING_METHODS.has(c.req.method)) {
    await next();
    return;
  }

  if (!(await isEmailVerificationRequiredForWrites())) {
    await next();
    return;
  }

  const isEmailVerified = c.get("userEmailVerified");
  if (isEmailVerified === true) {
    await next();
    return;
  }

  throw appError("AUTH_FORBIDDEN", { reason: "email_verification_required_for_write_operations" });
}
