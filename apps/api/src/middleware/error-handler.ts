import type { Context, Next } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { captureException } from "@genius/shared";
import { AppError } from "../lib/http";
import type { ApiAppEnv } from "../lib/hono-env";

export async function errorHandlerMiddleware(c: Context<ApiAppEnv>, next: Next) {
  try {
    await next();
  } catch (error) {
    const requestId = c.get("requestId") as string | undefined;

    if (error instanceof AppError) {
      const status = error.status as ContentfulStatusCode;
      return c.json(
        {
          error: {
            code: error.code,
            message: error.message,
            details: error.details
          },
          meta: {
            requestId
          }
        },
        status
      );
    }

    await captureException({
      service: "api",
      error,
      context: {
        requestId,
        path: c.req.path,
        method: c.req.method
      }
    });

    return c.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Internal error"
        },
        meta: {
          requestId
        }
      },
      500
    );
  }
}
