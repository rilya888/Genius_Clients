import { NextResponse } from "next/server";
import { generateCsrfToken, getCsrfCookieName } from "../../../lib/csrf";

export async function GET() {
  const token = generateCsrfToken();
  const response = NextResponse.json({ data: { csrfToken: token } });

  response.cookies.set({
    name: getCsrfCookieName(),
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV !== "development",
    path: "/"
  });

  return response;
}
