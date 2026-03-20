import { httpJson } from "./http";

type SessionPayload = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresInSeconds?: number;
  refreshTokenExpiresAt?: string;
};

type AuthEnvelope = {
  data: {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: string;
    session?: SessionPayload;
    slug?: string;
  };
};

type MeEnvelope = {
  data: {
    userId: string;
    email: string;
    tenantId: string;
    role: string;
    isEmailVerified: boolean;
  };
};

function normalizeSession(data: AuthEnvelope["data"]) {
  const session = data.session;
  const accessToken = data.accessToken ?? session?.accessToken;
  const refreshToken = data.refreshToken ?? session?.refreshToken;

  if (!accessToken || !refreshToken) {
    throw new Error("AUTH_SESSION_INVALID");
  }

  const expiresAt =
    data.expiresAt ??
    (typeof session?.accessTokenExpiresInSeconds === "number"
      ? new Date(Date.now() + session.accessTokenExpiresInSeconds * 1000).toISOString()
      : new Date(Date.now() + 15 * 60 * 1000).toISOString());

  return { accessToken, refreshToken, expiresAt, slug: data.slug };
}

export async function login(input: { email: string; password: string }) {
  const payload = await httpJson<AuthEnvelope>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify(input)
  });
  return normalizeSession(payload.data);
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
  return normalizeSession(payload.data);
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

export async function refreshSession(input: { refreshToken: string }) {
  const payload = await httpJson<AuthEnvelope>("/api/v1/auth/refresh", {
    method: "POST",
    body: JSON.stringify(input)
  });
  return normalizeSession(payload.data);
}

export async function me(accessToken: string) {
  const payload = await httpJson<MeEnvelope>("/api/v1/auth/me", {
    method: "GET",
    headers: {
      authorization: `Bearer ${accessToken}`
    }
  });
  return payload.data;
}

export async function logout(refreshToken?: string | null) {
  await httpJson<{ data: { ok: boolean } }>("/api/v1/auth/logout", {
    method: "POST",
    body: JSON.stringify(refreshToken ? { refreshToken } : {})
  });
}
