import type { Context, Next } from "hono";
import { appError } from "../../lib/http";
import { getSuperAdminEnv } from "../../lib/super-admin/env";
import { verifySuperAdminToken } from "../../lib/super-admin/token";

function parseCookieHeader(header: string | undefined): Record<string, string> {
  if (!header) {
    return {};
  }

  return header.split(";").reduce<Record<string, string>>((acc, item) => {
    const [rawKey, ...rawValue] = item.trim().split("=");
    const key = rawKey?.trim();
    if (!key) {
      return acc;
    }
    acc[key] = rawValue.join("=").trim();
    return acc;
  }, {});
}

export async function superAdminSessionAuthMiddleware(c: Context, next: Next) {
  const env = getSuperAdminEnv();
  const cookies = parseCookieHeader(c.req.header("cookie"));
  const token = cookies[env.cookieName];

  if (!token) {
    throw appError("AUTH_UNAUTHORIZED", { reason: "super_admin_session_missing" });
  }

  const payload = verifySuperAdminToken(token, env.sessionSecret);
  if (!payload) {
    throw appError("AUTH_UNAUTHORIZED", { reason: "super_admin_session_invalid" });
  }

  await next();
}
