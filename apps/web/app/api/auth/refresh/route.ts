import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { callInternalApi } from "../../../../lib/internal-api";
import { clearAuthCookies, REFRESH_TOKEN_COOKIE, setAuthCookies } from "../../../../lib/auth-cookie";

export async function POST() {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get(REFRESH_TOKEN_COOKIE)?.value;

  const response = await callInternalApi("/api/v1/auth/refresh", {
    method: "POST",
    body: { refreshToken }
  });
  const payload = await response.json();
  const outgoing = NextResponse.json(payload, { status: response.status });

  const session = payload?.data?.session;
  if (
    response.ok &&
    session?.accessToken &&
    session?.refreshToken &&
    Number.isInteger(session?.accessTokenExpiresInSeconds) &&
    session?.refreshTokenExpiresAt
  ) {
    setAuthCookies(outgoing, {
      accessToken: String(session.accessToken),
      refreshToken: String(session.refreshToken),
      accessTokenExpiresInSeconds: Number(session.accessTokenExpiresInSeconds),
      refreshTokenExpiresAt: String(session.refreshTokenExpiresAt)
    });
  } else if (!response.ok) {
    clearAuthCookies(outgoing);
  }

  return outgoing;
}
