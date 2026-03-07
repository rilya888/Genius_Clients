import { getRequiredEnv } from "@genius/shared";

export type ApiEnv = {
  internalApiSecret: string;
  authTokenSecret: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlDays: number;
  passwordResetTokenTtlMinutes: number;
  emailVerificationTokenTtlMinutes: number;
};

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
      : 1440
  };
}
