import { Hono } from "hono";
import type { ApiAppEnv } from "../../lib/hono-env";
import { AppError, appError } from "../../lib/http";
import { AuthService } from "../../services";

const authService = new AuthService();

export const authRoutes = new Hono<ApiAppEnv>()
  .get("/me", async (c) => {
    const authorization = c.req.header("authorization");
    const accessToken = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length).trim()
      : undefined;

    return c.json({ data: await authService.me({ accessToken }) });
  })
  .post("/register", async (c) => {
    const body = await c.req.json<{
      email?: string;
      password?: string;
      businessName?: string;
      slug?: string;
    }>();

    if (!body.email || !body.password || !body.businessName) {
      throw appError("VALIDATION_ERROR", {
        required: ["email", "password", "businessName"]
      });
    }

    let data;
    try {
      data = await authService.register({
        email: body.email,
        password: body.password,
        businessName: body.businessName,
        slug: body.slug
      });
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw appError("VALIDATION_ERROR", {
        reason: error instanceof Error ? error.message : "register_validation_failed"
      });
    }

    return c.json({ data }, 201);
  })
  .post("/login", async (c) => {
    const body = await c.req.json<{ email?: string; password?: string }>();
    return c.json({ data: await authService.login(body) });
  })
  .post("/refresh", async (c) => {
    const body = await c.req.json<{ refreshToken?: string }>().catch(() => ({}));
    return c.json({ data: await authService.refresh({ refreshToken: body.refreshToken }) });
  })
  .post("/logout", async (c) => {
    const body = await c.req.json<{ refreshToken?: string }>().catch(() => ({}));
    return c.json({ data: await authService.logout({ refreshToken: body.refreshToken }) });
  })
  .post("/forgot-password", async (c) => {
    const body = await c.req.json<{ email?: string }>().catch(() => ({}));
    return c.json({ data: await authService.forgotPassword(body) });
  })
  .post("/reset-password", async (c) => {
    const body = await c.req.json<{ token?: string; password?: string }>();
    return c.json({ data: await authService.resetPassword(body) });
  })
  .post("/request-email-verification", async (c) => {
    const body = await c.req.json<{ email?: string }>().catch(() => ({}));
    return c.json({ data: await authService.requestEmailVerification(body) });
  })
  .post("/verify-email", async (c) => {
    const body = await c.req.json<{ token?: string }>().catch(() => ({}));
    return c.json({ data: await authService.verifyEmail(body) });
  });
