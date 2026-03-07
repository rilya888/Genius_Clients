import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { clearAuthCookies, REFRESH_TOKEN_COOKIE } from "../../../../lib/auth-cookie";
import { callInternalApi } from "../../../../lib/internal-api";

export async function POST() {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get(REFRESH_TOKEN_COOKIE)?.value;

  const response = await callInternalApi("/api/v1/auth/logout", {
    method: "POST",
    body: { refreshToken }
  });
  const payload = await response.json();
  const outgoing = NextResponse.json(payload, { status: response.status });

  clearAuthCookies(outgoing);
  return outgoing;
}

