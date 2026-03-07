import { NextResponse } from "next/server";
import { callInternalApi } from "../../../../lib/internal-api";

export async function GET() {
  const response = await callInternalApi("/api/v1/health", { method: "GET" });
  const payload = await response.json();
  return NextResponse.json(payload, { status: response.status });
}
