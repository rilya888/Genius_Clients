import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { requestContextMiddleware } from "./middleware/request-context";
import { errorHandlerMiddleware } from "./middleware/error-handler";
import { createApiV1Routes } from "./routes";
import type { ApiAppEnv } from "./lib/hono-env";

const app = new Hono<ApiAppEnv>();

app.use("*", requestContextMiddleware);
app.use("*", errorHandlerMiddleware);

app.route("/api/v1", createApiV1Routes());

const port = Number(process.env.PORT ?? 3001);

serve({
  fetch: app.fetch,
  port
});

console.log(`[api] listening on :${port}`);
