import { getRequiredEnv } from "@genius/shared";

export type SuperAdminEnv = {
  loginSecret: string;
  sessionSecret: string;
  sessionTtlHours: number;
  cookieName: string;
};

export function getSuperAdminEnv(): SuperAdminEnv {
  const sessionTtlHoursRaw = Number(process.env.SUPER_ADMIN_SESSION_TTL_HOURS ?? "12");
  const fallbackSecret = process.env.INTERNAL_API_SECRET?.trim();
  const loginSecret = process.env.SUPER_ADMIN_LOGIN_SECRET?.trim() || fallbackSecret;
  const sessionSecret = process.env.SUPER_ADMIN_SESSION_SECRET?.trim() || fallbackSecret;

  return {
    loginSecret: loginSecret || getRequiredEnv("SUPER_ADMIN_LOGIN_SECRET"),
    sessionSecret: sessionSecret || getRequiredEnv("SUPER_ADMIN_SESSION_SECRET"),
    sessionTtlHours:
      Number.isFinite(sessionTtlHoursRaw) && sessionTtlHoursRaw > 0 ? Math.floor(sessionTtlHoursRaw) : 12,
    cookieName: process.env.SUPER_ADMIN_COOKIE_NAME?.trim() || "gc_super_admin_session"
  };
}
