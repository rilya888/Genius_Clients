import type { Context, Next } from "hono";
import { createRequestId } from "../lib/request-id";
import type { ApiAppEnv } from "../lib/hono-env";

export async function requestContextMiddleware(c: Context<ApiAppEnv>, next: Next) {
  const requestId = c.req.header("x-request-id") ?? createRequestId();
  c.set("requestId", requestId);
  c.header("x-request-id", requestId);
  await next();
}
