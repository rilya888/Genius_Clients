import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { normalizeHost } from "@genius/shared";
import { requestContextMiddleware } from "./middleware/request-context";
import { errorHandlerMiddleware, handleApiError } from "./middleware/error-handler";
import { createApiV1Routes } from "./routes";
import type { ApiAppEnv } from "./lib/hono-env";
import { getApiEnv } from "./lib/env";

const app = new Hono<ApiAppEnv>();
app.onError((error, c) => handleApiError(error, c));

const configuredCorsOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const implicitCorsOrigins = [process.env.APP_URL, process.env.WEB_URL]
  .map((item) => item?.trim())
  .filter((item): item is string => Boolean(item));
const allowedCorsOrigins = new Set([...configuredCorsOrigins, ...implicitCorsOrigins]);
const tenantBaseDomain = normalizeHost(getApiEnv().tenantBaseDomain);

function isAllowedRailwayWebOrigin(origin: string) {
  return /^https:\/\/web-[a-z0-9-]+\.up\.railway\.app$/i.test(origin);
}

function isAllowedCustomWebOrigin(origin: string) {
  try {
    const url = new URL(origin);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    );
  } catch {
    return false;
  }
}

function isAllowedTenantOrigin(origin: string) {
  if (!tenantBaseDomain) {
    return false;
  }
  try {
    const url = new URL(origin);
    const hostname = normalizeHost(url.hostname);
    if (!hostname || url.protocol !== "https:") {
      return false;
    }
    return hostname === tenantBaseDomain || hostname.endsWith(`.${tenantBaseDomain}`);
  } catch {
    return false;
  }
}

app.use("*", requestContextMiddleware);
app.use("*", errorHandlerMiddleware);
app.use(
  "/api/v1/*",
  cors({
    origin: (origin) => {
      if (!origin) {
        return undefined;
      }
      if (
        allowedCorsOrigins.has(origin) ||
        isAllowedRailwayWebOrigin(origin) ||
        isAllowedCustomWebOrigin(origin) ||
        isAllowedTenantOrigin(origin)
      ) {
        return origin;
      }
      return undefined;
    },
    allowHeaders: [
      "authorization",
      "content-type",
      "x-csrf-token",
      "x-internal-tenant-id",
      "x-internal-tenant-slug",
      "x-request-id"
    ],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    exposeHeaders: ["x-request-id"],
    credentials: true
  })
);

app.route("/api/v1", createApiV1Routes());

const port = Number(process.env.PORT ?? 3001);

serve({
  fetch: app.fetch,
  port
});

console.log(`[api] listening on :${port}`);
