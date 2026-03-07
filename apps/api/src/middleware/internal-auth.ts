import type { Context, Next } from "hono";
import { appError } from "../lib/http";
import { getApiEnv } from "../lib/env";
import type { ApiAppEnv } from "../lib/hono-env";

export async function internalAuthMiddleware(c: Context<ApiAppEnv>, next: Next) {
  const providedSecret = c.req.header("x-internal-secret");
  const expectedSecret = getApiEnv().internalApiSecret;

  if (!providedSecret || providedSecret !== expectedSecret) {
    throw appError("AUTH_UNAUTHORIZED");
  }

  await next();
}
