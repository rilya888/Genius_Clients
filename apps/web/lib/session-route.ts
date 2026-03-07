import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  clearAuthCookies,
  setAuthCookies
} from "./auth-cookie";
import { callInternalApi } from "./internal-api";

async function fetchMe(accessToken?: string) {
  return callInternalApi("/api/v1/auth/me", {
    method: "GET",
    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : undefined
  });
}

export async function resolveSessionResponse() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;
  const refreshToken = cookieStore.get(REFRESH_TOKEN_COOKIE)?.value;

  const meResponse = await fetchMe(accessToken);
  if (meResponse.ok) {
    const payload = await meResponse.json();
    return NextResponse.json(payload, { status: 200 });
  }

  if (!refreshToken) {
    const response = NextResponse.json(
      { error: { code: "AUTH_UNAUTHORIZED", message: "Unauthorized" } },
      { status: 401 }
    );
    clearAuthCookies(response);
    return response;
  }

  const refreshResponse = await callInternalApi("/api/v1/auth/refresh", {
    method: "POST",
    body: { refreshToken }
  });
  const refreshPayload = await refreshResponse.json();
  if (!refreshResponse.ok) {
    const response = NextResponse.json(refreshPayload, { status: refreshResponse.status });
    clearAuthCookies(response);
    return response;
  }

  const session = refreshPayload?.data?.session;
  const meAfterRefresh = await fetchMe(session?.accessToken ? String(session.accessToken) : undefined);
  const meAfterPayload = await meAfterRefresh.json();
  const response = NextResponse.json(meAfterPayload, { status: meAfterRefresh.status });

  if (!meAfterRefresh.ok) {
    clearAuthCookies(response);
    return response;
  }

  if (
    session?.accessToken &&
    session?.refreshToken &&
    Number.isInteger(session?.accessTokenExpiresInSeconds) &&
    session?.refreshTokenExpiresAt
  ) {
    setAuthCookies(response, {
      accessToken: String(session.accessToken),
      refreshToken: String(session.refreshToken),
      accessTokenExpiresInSeconds: Number(session.accessTokenExpiresInSeconds),
      refreshTokenExpiresAt: String(session.refreshTokenExpiresAt)
    });
  }

  return response;
}
