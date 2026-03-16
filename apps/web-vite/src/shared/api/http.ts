const API_BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8787";
const TENANT_SLUG = import.meta.env.VITE_TENANT_SLUG ?? "demo";

type HttpInit = RequestInit & {
  query?: Record<string, string | number | undefined | null>;
};

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
  const response = await fetch(buildUrl(path, init?.query), {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-internal-tenant-slug": TENANT_SLUG,
      ...(init?.headers ?? {})
    }
  });

  const payload = (await response.json().catch(() => null)) as T | null;
  if (!response.ok || !payload) {
    throw new Error(`HTTP_${response.status}`);
  }

  return payload;
}
