import type { Context, Next } from "hono";
import type { ApiAppEnv } from "../lib/hono-env";
import { appError } from "../lib/http";
import { BillingService } from "../services";

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const billingService = new BillingService();

function isBillingPath(path: string): boolean {
  return path.startsWith("/api/v1/admin/billing");
}

function isAlwaysAllowedInHardLock(path: string): boolean {
  if (isBillingPath(path)) {
    return true;
  }
  if (path === "/api/v1/admin/scope") {
    return true;
  }
  if (path === "/api/v1/admin/tenant-settings") {
    return true;
  }
  if (path === "/api/v1/admin/settings/operational") {
    return true;
  }
  return false;
}

export async function billingLifecycleGuardMiddleware(c: Context<ApiAppEnv>, next: Next) {
  const tenantId = c.get("tenantId");
  if (!tenantId) {
    await next();
    return;
  }

  const summary = await billingService.getBillingSubscriptionSummary(tenantId);
  const path = c.req.path;

  if (summary.hardLockActive && !isAlwaysAllowedInHardLock(path)) {
    throw appError("AUTH_FORBIDDEN", {
      reason: "billing_hard_lock_active",
      status: summary.status,
      billingState: summary.billingState
    });
  }

  if (
    summary.readOnlyActive &&
    STATE_CHANGING_METHODS.has(c.req.method) &&
    !isBillingPath(path)
  ) {
    throw appError("AUTH_FORBIDDEN", {
      reason: "billing_read_only_active",
      status: summary.status,
      billingState: summary.billingState
    });
  }

  await next();
}
