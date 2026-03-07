import { NextResponse } from "next/server";
import { callInternalApi } from "../../../../lib/internal-api";
import { clearAuthCookies, setAuthCookies } from "../../../../lib/auth-cookie";

export async function POST(req: Request) {
  const body = await req.json();
  const response = await callInternalApi("/api/v1/auth/register", {
    method: "POST",
    body
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
