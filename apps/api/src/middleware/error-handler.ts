import type { Context, Next } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { captureException } from "@genius/shared";
import { AppError } from "../lib/http";
import type { ApiAppEnv } from "../lib/hono-env";

function isAppErrorLike(error: unknown): error is {
  code: string;
  message: string;
  status: number;
  details?: unknown;
} {
  if (error instanceof AppError) {
    return true;
  }
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as Record<string, unknown>;
  return (
    typeof candidate.code === "string" &&
    typeof candidate.message === "string" &&
    typeof candidate.status === "number"
  );
}

export async function handleApiError(error: unknown, c: Context<ApiAppEnv>) {
  const requestId = c.get("requestId") as string | undefined;

  if (isAppErrorLike(error)) {
    const status = error.status as ContentfulStatusCode;
    console.error("[api] app error", {
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: error.status,
      code: error.code,
      details: error.details
    });
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

export async function errorHandlerMiddleware(c: Context<ApiAppEnv>, next: Next) {
  try {
    await next();
  } catch (error) {
    return handleApiError(error, c);
  }
}
