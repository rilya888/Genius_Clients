const DEFAULT_LOCAL_API_URL = "http://localhost:8787";
const TENANT_SLUG = import.meta.env.VITE_TENANT_SLUG ?? "demo";
const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function resolveApiBaseUrl() {
  const envUrl = import.meta.env.VITE_API_URL?.trim();
  if (envUrl) {
    return envUrl;
  }

  if (typeof window === "undefined") {
    return DEFAULT_LOCAL_API_URL;
  }

  const { hostname, origin, protocol } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return DEFAULT_LOCAL_API_URL;
  }

  // Railway naming fallback: web-xxx -> api-xxx.
  if (hostname.startsWith("web-") && hostname.endsWith(".up.railway.app")) {
    return `${protocol}//${hostname.replace(/^web-/, "api-")}`;
  }

  return origin;
}

const API_BASE_URL = resolveApiBaseUrl();

type HttpInit = RequestInit & {
  query?: Record<string, string | number | undefined | null>;
};

export class ApiHttpError extends Error {
  readonly status: number;
  readonly requestId: string | null;
  readonly code: string | null;

  constructor(input: { status: number; requestId: string | null; message: string; code?: string | null }) {
    super(input.message);
    this.name = "ApiHttpError";
    this.status = input.status;
    this.requestId = input.requestId;
    this.code = input.code ?? null;
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
  const headers = new Headers(init?.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  headers.set("x-internal-tenant-slug", TENANT_SLUG);
  const method = (init?.method ?? "GET").toUpperCase();
  if (STATE_CHANGING_METHODS.has(method) && !headers.has("x-csrf-token")) {
    headers.set("x-csrf-token", "spa-csrf");
  }

  const response = await fetch(buildUrl(path, init?.query), {
    ...init,
    headers
  });

  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: { message?: string; code?: string } })
    | null;
  if (!response.ok || !payload) {
    const message = payload?.error?.message ?? `HTTP_${response.status}`;
    const code = payload?.error?.code ?? null;
    throw new ApiHttpError({
      status: response.status,
      requestId: response.headers.get("x-request-id"),
      message,
      code
    });
  }

  return payload;
}
