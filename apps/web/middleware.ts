import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from "./lib/auth-cookie";

function hasSessionCookies(req: NextRequest): boolean {
  const access = req.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  const refresh = req.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
  return Boolean(access || refresh);
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/admin")) {
    if (!hasSessionCookies(req)) {
      const url = req.nextUrl.clone();
      url.pathname = "/auth";
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"]
};
