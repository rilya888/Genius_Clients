import { NextResponse } from "next/server";
import { callInternalApi } from "../../../../lib/internal-api";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const response = await callInternalApi("/api/v1/auth/verify-email", {
    method: "POST",
    body
  });
  const payload = await response.json();
  return NextResponse.json(payload, { status: response.status });
}
