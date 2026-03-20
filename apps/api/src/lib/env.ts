import { getRequiredEnv } from "@genius/shared";

export type ApiEnv = {
  internalApiSecret: string;
  authTokenSecret: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlDays: number;
  passwordResetTokenTtlMinutes: number;
  emailVerificationTokenTtlMinutes: number;
  tenantBaseDomain: string;
  tenantHostResolutionEnabled: boolean;
  tenantResolutionDebugHeadersEnabled: boolean;
  tenantBrowserHeaderFallbackEnabled: boolean;
  tenantTrustForwardedHost: boolean;
};

function asBoolean(value: string | undefined, fallback: boolean) {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
    return false;
  }
  return fallback;
}

export function getApiEnv(): ApiEnv {
  const accessTokenTtlSeconds = Number(process.env.ACCESS_TOKEN_TTL_SECONDS ?? "900");
  const refreshTokenTtlDays = Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? "30");
  const passwordResetTokenTtlMinutes = Number(process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES ?? "30");
  const emailVerificationTokenTtlMinutes = Number(
    process.env.EMAIL_VERIFICATION_TOKEN_TTL_MINUTES ?? "1440"
  );

  return {
    internalApiSecret: getRequiredEnv("INTERNAL_API_SECRET"),
    authTokenSecret: getRequiredEnv("AUTH_TOKEN_SECRET"),
    accessTokenTtlSeconds: Number.isFinite(accessTokenTtlSeconds) ? accessTokenTtlSeconds : 900,
    refreshTokenTtlDays: Number.isFinite(refreshTokenTtlDays) ? refreshTokenTtlDays : 30,
    passwordResetTokenTtlMinutes: Number.isFinite(passwordResetTokenTtlMinutes)
      ? passwordResetTokenTtlMinutes
      : 30,
    emailVerificationTokenTtlMinutes: Number.isFinite(emailVerificationTokenTtlMinutes)
      ? emailVerificationTokenTtlMinutes
      : 1440,
    tenantBaseDomain: (process.env.TENANT_BASE_DOMAIN ?? "geniusclients.info").trim().toLowerCase(),
    tenantHostResolutionEnabled: asBoolean(process.env.TENANT_HOST_RESOLUTION_ENABLED, false),
    tenantResolutionDebugHeadersEnabled: asBoolean(process.env.TENANT_RESOLUTION_DEBUG_HEADERS_ENABLED, false),
    tenantBrowserHeaderFallbackEnabled: asBoolean(
      process.env.TENANT_BROWSER_HEADER_FALLBACK_ENABLED,
      true
    ),
    tenantTrustForwardedHost: asBoolean(process.env.TENANT_TRUST_FORWARDED_HOST, false)
  };
}
