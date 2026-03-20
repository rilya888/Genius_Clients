import type { Context, Next } from "hono";
import { createRequestId } from "../lib/request-id";
import type { ApiAppEnv } from "../lib/hono-env";

export async function requestContextMiddleware(c: Context<ApiAppEnv>, next: Next) {
  const requestId = c.req.header("x-request-id") ?? createRequestId();
  const requestHostRaw = c.req.header("x-forwarded-host") ?? c.req.header("host");
  const requestHost = requestHostRaw?.split(",")[0]?.trim().toLowerCase().replace(/:\d+$/, "");
  c.set("requestId", requestId);
  if (requestHost) {
    c.set("requestHost", requestHost);
  }
  c.header("x-request-id", requestId);
  await next();
}
