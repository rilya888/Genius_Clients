import { Hono } from "hono";
import { authRoutes } from "./auth";
import { publicRoutes } from "./public";
import { adminRoutes } from "./admin";
import { superAdminRoutes } from "./super-admin";
import { webhookRoutes } from "./webhooks";
import { tenantContextMiddleware } from "../middleware/tenant-context";
import { rateLimitMiddleware } from "../middleware/rate-limit";
import { csrfMiddleware } from "../middleware/csrf";
import { sessionAuthMiddleware } from "../middleware/session-auth";
import type { ApiAppEnv } from "../lib/hono-env";
import { getDb } from "../lib/db";
import { sql } from "drizzle-orm";
import { pingRedis } from "../lib/redis";

export function createApiV1Routes() {
  const apiV1 = new Hono<ApiAppEnv>();

  apiV1.get("/health", (c) => {
    return c.json({ data: { status: "ok", service: "api" } });
  });

  apiV1.get("/ready", async (c) => {
    const redis = await pingRedis();

    try {
      const db = getDb();
      await db.execute(sql`SELECT 1`);
      const ready = redis !== "error";
      return c.json({
        data: {
          status: ready ? "ready" : "not_ready",
          checks: {
            db: "ok",
            redis,
            queue: "unknown"
          }
        }
      }, ready ? 200 : 503);
    } catch (error) {
      return c.json(
        {
          data: {
            status: "not_ready",
            checks: {
              db: "error",
              redis,
              queue: "unknown"
            },
            error: error instanceof Error ? error.message : "db_not_ready"
          }
        },
        503
      );
    }
  });

  apiV1.use("/auth/*", rateLimitMiddleware);
  apiV1.route("/auth", authRoutes);

  apiV1.use("/public/*", rateLimitMiddleware);
  apiV1.use("/public/*", tenantContextMiddleware);
  apiV1.route("/public", publicRoutes);

  apiV1.use("/admin/*", rateLimitMiddleware);
  apiV1.use("/admin/*", sessionAuthMiddleware);
  apiV1.use("/admin/*", tenantContextMiddleware);
  apiV1.use("/admin/*", csrfMiddleware);
  apiV1.route("/admin", adminRoutes);

  apiV1.use("/super-admin/*", rateLimitMiddleware);
  apiV1.route("/super-admin", superAdminRoutes);

  apiV1.use("/webhooks/*", rateLimitMiddleware);
  apiV1.route("/webhooks", webhookRoutes);

  return apiV1;
}
