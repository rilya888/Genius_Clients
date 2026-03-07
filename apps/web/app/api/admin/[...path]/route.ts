import { NextResponse } from "next/server";
import { callInternalApi } from "../../../../lib/internal-api";

type Params = { params: { path?: string[] } | Promise<{ path?: string[] }> };
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

function toInternalPath(path: string[] | undefined, query: string): string {
  const cleanPath = (path ?? []).join("/");
  const suffix = query ? `?${query}` : "";
  return `/api/v1/admin/${cleanPath}${suffix}`;
}

async function proxy(req: Request, params: Params, method: Method) {
  const resolvedParams = await Promise.resolve(params.params);
  const { path } = resolvedParams;
  const url = new URL(req.url);
  const query = url.searchParams.toString();
  const internalPath = toInternalPath(path, query);

  const body =
    method === "GET"
      ? undefined
      : await req
          .json()
          .catch(() => ({}));

  const response = await callInternalApi(internalPath, { method, body });
  const payload = await response.json();
  return NextResponse.json(payload, { status: response.status });
}

export async function GET(req: Request, params: Params) {
  return proxy(req, params, "GET");
}

export async function POST(req: Request, params: Params) {
  return proxy(req, params, "POST");
}

export async function PUT(req: Request, params: Params) {
  return proxy(req, params, "PUT");
}

export async function PATCH(req: Request, params: Params) {
  return proxy(req, params, "PATCH");
}

export async function DELETE(req: Request, params: Params) {
  return proxy(req, params, "DELETE");
}
