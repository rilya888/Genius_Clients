import { cookies, headers } from "next/headers";
import { resolveTenantFromHost } from "./tenant";
import { getCsrfCookieName } from "./csrf";
import { ACCESS_TOKEN_COOKIE } from "./auth-cookie";

type RequestMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

const STATE_CHANGING_METHODS = new Set<RequestMethod>(["POST", "PUT", "PATCH", "DELETE"]);

export async function callInternalApi(
  path: string,
  options?: { method?: RequestMethod; body?: unknown; headers?: Record<string, string> }
) {
  const method = options?.method ?? "GET";
  const hdrs = await headers();
  const cookieStore = await cookies();
  const host = hdrs.get("host");
  const requestId = hdrs.get("x-request-id") ?? undefined;
  const csrf =
    hdrs.get("x-csrf-token") ?? cookieStore.get(getCsrfCookieName())?.value ?? undefined;
  const accessToken = cookieStore.get(ACCESS_TOKEN_COOKIE)?.value;

  const resolved = resolveTenantFromHost(host);
  const fallbackTenantSlug =
    process.env.INTERNAL_DEFAULT_TENANT_SLUG ?? process.env.DEFAULT_TENANT_SLUG ?? undefined;
  const fallbackTenantId = process.env.INTERNAL_DEFAULT_TENANT_ID ?? undefined;
  const effectiveTenantSlug = resolved.slug ?? fallbackTenantSlug;

  const requestHeaders: Record<string, string> = {
    "content-type": "application/json",
    "x-internal-secret": process.env.INTERNAL_API_SECRET ?? ""
  };

  if (fallbackTenantId) {
    requestHeaders["x-internal-tenant-id"] = fallbackTenantId;
  }

  if (effectiveTenantSlug) {
    requestHeaders["x-internal-tenant-slug"] = effectiveTenantSlug;
  }

  if (requestId) {
    requestHeaders["x-request-id"] = requestId;
  }

  if (STATE_CHANGING_METHODS.has(method)) {
    requestHeaders["x-csrf-token"] = csrf ?? "bff-csrf";
  }

  if (accessToken) {
    requestHeaders.authorization = `Bearer ${accessToken}`;
  }

  if (options?.headers) {
    for (const [key, value] of Object.entries(options.headers)) {
      requestHeaders[key.toLowerCase()] = value;
    }
  }

  const response = await fetch(`${process.env.API_URL}${path}`, {
    method,
    headers: requestHeaders,
    body: options?.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store"
  });

  return response;
}
