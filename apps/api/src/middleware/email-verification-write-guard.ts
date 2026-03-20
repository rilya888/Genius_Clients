import type { Context, Next } from "hono";
import type { ApiAppEnv } from "../lib/hono-env";
import { appError } from "../lib/http";
import { getApiEnv } from "../lib/env";

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function emailVerificationWriteGuardMiddleware(c: Context<ApiAppEnv>, next: Next) {
  if (!STATE_CHANGING_METHODS.has(c.req.method)) {
    await next();
    return;
  }

  if (!getApiEnv().authEmailVerificationRequired) {
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
