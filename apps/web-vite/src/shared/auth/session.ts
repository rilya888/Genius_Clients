import { refreshSession } from "../api/authApi";

const ACCESS_TOKEN_KEY = "access_token";
const REFRESH_TOKEN_KEY = "refresh_token";
const ACCESS_EXPIRES_AT_KEY = "access_expires_at";
const REFRESH_SKEW_MS = 20_000;

let refreshInFlight: Promise<string | null> | null = null;

export function saveSession(input: { accessToken: string; refreshToken: string; expiresAt: string }) {
  localStorage.setItem(ACCESS_TOKEN_KEY, input.accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, input.refreshToken);
  localStorage.setItem(ACCESS_EXPIRES_AT_KEY, input.expiresAt);
}

export function clearSession() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(ACCESS_EXPIRES_AT_KEY);
}

function getAccessToken() {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken() {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

function isExpired(expiresAt: string | null) {
  if (!expiresAt) {
    return true;
  }
  const ts = Date.parse(expiresAt);
  if (!Number.isFinite(ts)) {
    return true;
  }
  return ts - REFRESH_SKEW_MS <= Date.now();
}

export async function forceRefreshAccessToken() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    clearSession();
    return null;
  }
  if (!refreshInFlight) {
    refreshInFlight = refreshSession({ refreshToken })
      .then((data) => {
        saveSession(data);
        return data.accessToken;
      })
      .catch(() => {
        clearSession();
        return null;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

export async function ensureAccessToken() {
  const accessToken = getAccessToken();
  const expiresAt = localStorage.getItem(ACCESS_EXPIRES_AT_KEY);
  if (accessToken && !isExpired(expiresAt)) {
    return accessToken;
  }
  return forceRefreshAccessToken();
}
