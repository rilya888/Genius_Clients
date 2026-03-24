import { resolveBrowserTenantContext } from "../routing/tenant-host";

const DEFAULT_LOCAL_API_URL = "http://localhost:8787";
const DEFAULT_PRODUCTION_API_URL = "https://api-production-9caa.up.railway.app";
const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function resolveApiBaseUrl() {
  const envUrl = import.meta.env.VITE_API_URL?.trim();
  if (envUrl) {
    return envUrl;
  }

  if (typeof window === "undefined") {
    return DEFAULT_LOCAL_API_URL;
  }

  const { hostname } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return DEFAULT_LOCAL_API_URL;
  }

  // Railway domains for web and api can have different suffixes.
  // Use explicit production API fallback when build-time VITE_API_URL is not injected.
  return DEFAULT_PRODUCTION_API_URL;
}

const API_BASE_URL = resolveApiBaseUrl();

type HttpInit = RequestInit & {
  query?: Record<string, string | number | undefined | null>;
};

export class ApiHttpError extends Error {
  readonly status: number;
  readonly requestId: string | null;
  readonly code: string | null;
  readonly details: unknown;

  constructor(input: {
    status: number;
    requestId: string | null;
    message: string;
    code?: string | null;
    details?: unknown;
  }) {
    super(input.message);
    this.name = "ApiHttpError";
    this.status = input.status;
    this.requestId = input.requestId;
    this.code = input.code ?? null;
    this.details = input.details ?? null;
  }
}

function buildUrl(path: string, query?: HttpInit["query"]) {
  const url = new URL(path.startsWith("/") ? path : `/${path}`, API_BASE_URL);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") {
        continue;
      }
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

export async function httpJson<T>(path: string, init?: HttpInit): Promise<T> {
  const tenantContext = resolveBrowserTenantContext();
  const headers = new Headers(init?.headers);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (tenantContext.needsTenantHeader && tenantContext.slug) {
    headers.set("x-internal-tenant-slug", tenantContext.slug);
  }
  const method = (init?.method ?? "GET").toUpperCase();
  const isPublicApiRequest = normalizedPath.startsWith("/api/v1/public/");
  if (STATE_CHANGING_METHODS.has(method) && !isPublicApiRequest && !headers.has("x-csrf-token")) {
    headers.set("x-csrf-token", "spa-csrf");
  }

  const response = await fetch(buildUrl(normalizedPath, init?.query), {
    ...init,
    headers
  });

  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: { message?: string; code?: string; details?: unknown } })
    | null;
  if (!response.ok || !payload) {
    const message = payload?.error?.message ?? `HTTP_${response.status}`;
    const code = payload?.error?.code ?? null;
    throw new ApiHttpError({
      status: response.status,
      requestId: response.headers.get("x-request-id"),
      message,
      code,
      details: payload?.error?.details
    });
  }

  return payload;
}
