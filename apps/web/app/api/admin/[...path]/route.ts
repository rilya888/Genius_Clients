import { NextResponse } from "next/server";
import { callInternalApi } from "../../../../lib/internal-api";

type RouteContext = { params: Promise<{ path: string[] }> };
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

function toInternalPath(path: string[] | undefined, query: string): string {
  const cleanPath = (path ?? []).join("/");
  const suffix = query ? `?${query}` : "";
  return `/api/v1/admin/${cleanPath}${suffix}`;
}

async function proxy(req: Request, context: RouteContext, method: Method) {
  const { path } = await context.params;
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
  const payload = await response
    .json()
    .catch(async () => ({
      error: {
        code: "UPSTREAM_INVALID_RESPONSE",
        message: await response.text().catch(() => "Internal Server Error")
      }
    }));
  return NextResponse.json(payload, { status: response.status });
}

export async function GET(req: Request, context: RouteContext) {
  return proxy(req, context, "GET");
}

export async function POST(req: Request, context: RouteContext) {
  return proxy(req, context, "POST");
}

export async function PUT(req: Request, context: RouteContext) {
  return proxy(req, context, "PUT");
}

export async function PATCH(req: Request, context: RouteContext) {
  return proxy(req, context, "PATCH");
}

export async function DELETE(req: Request, context: RouteContext) {
  return proxy(req, context, "DELETE");
}
