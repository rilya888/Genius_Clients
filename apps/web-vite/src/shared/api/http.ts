const DEFAULT_LOCAL_API_URL = "http://localhost:8787";
const DEFAULT_PRODUCTION_API_URL = "https://api-production-9caa.up.railway.app";
const DEFAULT_TENANT_SLUG = import.meta.env.VITE_TENANT_SLUG ?? "demo";
const TENANT_BASE_DOMAIN = (import.meta.env.VITE_TENANT_BASE_DOMAIN ?? "geniusclients.info").trim().toLowerCase();
const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const RESERVED_SUBDOMAINS = new Set([
  "www",
  "app",
  "api",
  "admin",
  "super-admin",
  "mail",
  "support",
  "help",
  "billing",
  "status",
  "blog",
  "docs"
]);

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

function normalizeHost(value: string): string {
  return value.trim().toLowerCase().replace(/:\d+$/, "");
}

function extractTenantSlugFromHost(hostname: string, baseDomain: string): string | null {
  const host = normalizeHost(hostname);
  const domain = normalizeHost(baseDomain);
  if (!host || !domain || host === domain) {
    return null;
  }

  const suffix = `.${domain}`;
  if (!host.endsWith(suffix)) {
    return null;
  }

  const subdomain = host.slice(0, -suffix.length);
  if (!subdomain || subdomain.includes(".") || RESERVED_SUBDOMAINS.has(subdomain)) {
    return null;
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(subdomain)) {
    return null;
  }
  return subdomain;
}

function resolveTenantSlug() {
  if (typeof window === "undefined") {
    return { slug: DEFAULT_TENANT_SLUG, needsTenantHeader: true };
  }
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") {
    return { slug: DEFAULT_TENANT_SLUG, needsTenantHeader: true };
  }
  const hostTenantSlug = extractTenantSlugFromHost(host, TENANT_BASE_DOMAIN);
  if (hostTenantSlug) {
    return { slug: hostTenantSlug, needsTenantHeader: false };
  }
  return { slug: DEFAULT_TENANT_SLUG, needsTenantHeader: true };
}

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
  const tenantContext = resolveTenantSlug();
  const headers = new Headers(init?.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (tenantContext.needsTenantHeader) {
    headers.set("x-internal-tenant-slug", tenantContext.slug);
  }
  const method = (init?.method ?? "GET").toUpperCase();
  if (STATE_CHANGING_METHODS.has(method) && !headers.has("x-csrf-token")) {
    headers.set("x-csrf-token", "spa-csrf");
  }

  const response = await fetch(buildUrl(path, init?.query), {
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
