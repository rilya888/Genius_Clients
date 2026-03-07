import type { Context, Next } from "hono";
import type { ApiAppEnv } from "../lib/hono-env";
import { appError } from "../lib/http";
import { verifySessionToken } from "../lib/token";
import { getApiEnv } from "../lib/env";
import { UserRepository } from "../repositories";

const userRepository = new UserRepository();

export async function sessionAuthMiddleware(c: Context<ApiAppEnv>, next: Next) {
  const authorization = c.req.header("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw appError("AUTH_UNAUTHORIZED", { reason: "missing_bearer_token" });
  }

  const token = authorization.slice("Bearer ".length).trim();
  if (!token) {
    throw appError("AUTH_UNAUTHORIZED", { reason: "empty_bearer_token" });
  }

  const payload = verifySessionToken(token, getApiEnv().authTokenSecret);
  if (!payload || payload.type !== "access") {
    throw appError("AUTH_UNAUTHORIZED", { reason: "invalid_access_token" });
  }

  const user = await userRepository.findById(payload.sub);
  if (!user || !user.isActive) {
    throw appError("AUTH_UNAUTHORIZED", { reason: "user_not_active" });
  }

  if (user.tokenVersion !== payload.tokenVersion) {
    throw appError("AUTH_UNAUTHORIZED", { reason: "access_token_version_mismatch" });
  }

  if (user.tenantId !== payload.tenantId) {
    throw appError("AUTH_FORBIDDEN", { reason: "access_token_tenant_mismatch" });
  }

  const tenantId = c.get("tenantId");
  if (tenantId !== user.tenantId) {
    throw appError("AUTH_FORBIDDEN", { reason: "request_tenant_mismatch" });
  }

  if (user.role !== "owner" && user.role !== "admin") {
    throw appError("AUTH_FORBIDDEN", { reason: "user_role_not_allowed" });
  }

  c.set("userId", user.id);
  c.set("userRole", user.role);
  await next();
}
