const TENANT_BASE_DOMAIN = (import.meta.env.VITE_TENANT_BASE_DOMAIN ?? "geniusclients.info").trim().toLowerCase();
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

function normalizeHost(value: string): string {
  return value.trim().toLowerCase().replace(/:\d+$/, "");
}

export function extractTenantSlugFromBrowserHost(hostname: string): string | null {
  const host = normalizeHost(hostname);
  if (!host || !TENANT_BASE_DOMAIN || host === TENANT_BASE_DOMAIN) {
    return null;
  }

  const suffix = `.${TENANT_BASE_DOMAIN}`;
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

export function resolveCurrentTenantSlug(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  const host = normalizeHost(window.location.hostname);
  if (host === "localhost" || host === "127.0.0.1") {
    return null;
  }
  return extractTenantSlugFromBrowserHost(host);
}

export function buildTenantAppUrl(slug: string): string {
  const normalizedSlug = slug.trim().toLowerCase();
  if (typeof window === "undefined") {
    return `/app`;
  }

  const { hostname, protocol } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return `/app`;
  }

  return `${protocol}//${normalizedSlug}.${TENANT_BASE_DOMAIN}/app`;
}
