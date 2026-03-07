import type { Context, Next } from "hono";
import { appError } from "../lib/http";
import type { ApiAppEnv } from "../lib/hono-env";

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * CSRF token enforcement for BFF-originated state-changing requests.
 */
export async function csrfMiddleware(c: Context<ApiAppEnv>, next: Next) {
  if (!STATE_CHANGING_METHODS.has(c.req.method)) {
    await next();
    return;
  }

  const csrfToken = c.req.header("x-csrf-token");
  if (!csrfToken) {
    throw appError("AUTH_FORBIDDEN", { reason: "missing csrf token" });
  }

  await next();
}
