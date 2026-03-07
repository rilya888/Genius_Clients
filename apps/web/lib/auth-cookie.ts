import type { NextResponse } from "next/server";

export const ACCESS_TOKEN_COOKIE = "gc_access_token";
export const REFRESH_TOKEN_COOKIE = "gc_refresh_token";

function cookieDomain(): string | undefined {
  const value = process.env.SESSION_COOKIE_DOMAIN?.trim();
  return value ? value : undefined;
}

function secureCookie(): boolean {
  return process.env.NODE_ENV !== "development";
}

export function setAuthCookies(
  response: NextResponse,
  input: {
    accessToken: string;
    refreshToken: string;
    accessTokenExpiresInSeconds: number;
    refreshTokenExpiresAt: string;
  }
): void {
  const domain = cookieDomain();
  const common = {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: secureCookie(),
    path: "/"
  };

  response.cookies.set({
    name: ACCESS_TOKEN_COOKIE,
    value: input.accessToken,
    maxAge: input.accessTokenExpiresInSeconds,
    domain,
    ...common
  });
  response.cookies.set({
    name: REFRESH_TOKEN_COOKIE,
    value: input.refreshToken,
    expires: new Date(input.refreshTokenExpiresAt),
    domain,
    ...common
  });
}

export function clearAuthCookies(response: NextResponse): void {
  const domain = cookieDomain();
  const common = {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: secureCookie(),
    path: "/",
    maxAge: 0
  };

  response.cookies.set({ name: ACCESS_TOKEN_COOKIE, value: "", domain, ...common });
  response.cookies.set({ name: REFRESH_TOKEN_COOKIE, value: "", domain, ...common });
}

