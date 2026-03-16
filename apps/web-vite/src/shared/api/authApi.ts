import { httpJson } from "./http";

type AuthEnvelope = {
  data: {
    accessToken: string;
    refreshToken: string;
    expiresAt: string;
  };
};

export async function login(input: { email: string; password: string }) {
  const payload = await httpJson<AuthEnvelope>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify(input)
  });
  return payload.data;
}

export async function register(input: {
  email: string;
  password: string;
  businessName: string;
}) {
  const payload = await httpJson<AuthEnvelope>("/api/v1/auth/register", {
    method: "POST",
    body: JSON.stringify(input)
  });
  return payload.data;
}

export async function forgotPassword(input: { email: string }) {
  await httpJson<{ data: { ok: boolean } }>("/api/v1/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function resetPassword(input: { token: string; password: string }) {
  await httpJson<{ data: { ok: boolean } }>("/api/v1/auth/reset-password", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function requestEmailVerification(input: { email: string }) {
  await httpJson<{ data: { ok: boolean } }>("/api/v1/auth/request-email-verification", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function verifyEmail(input: { token: string }) {
  await httpJson<{ data: { ok: boolean } }>("/api/v1/auth/verify-email", {
    method: "POST",
    body: JSON.stringify(input)
  });
}
