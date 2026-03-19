const DEFAULT_LOCAL_API_URL = "http://localhost:8787";
const DEFAULT_PRODUCTION_API_URL = "https://api-production-9caa.up.railway.app";

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

  return DEFAULT_PRODUCTION_API_URL;
}

const API_BASE_URL = resolveApiBaseUrl();
const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export type SuperAdminApiError = {
  code?: string;
  message?: string;
};

export async function superAdminRequest<T>(
  path: string,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; data?: T; error?: SuperAdminApiError }> {
  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json");
  const method = (init?.method ?? "GET").toUpperCase();
  if (STATE_CHANGING_METHODS.has(method) && !headers.has("x-csrf-token")) {
    headers.set("x-csrf-token", "spa-super-admin-csrf");
  }

  const response = await fetch(
    new URL(path.startsWith("/") ? path : `/${path}`, API_BASE_URL).toString(),
    {
      ...init,
      headers,
      credentials: "include"
    }
  );
  const payload = (await response.json().catch(() => null)) as
    | { data?: T; error?: SuperAdminApiError }
    | null;

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: payload?.error ?? { message: `HTTP_${response.status}` }
    };
  }

  return { ok: true, status: response.status, data: payload?.data };
}
