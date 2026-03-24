const DEFAULT_TENANT_SLUG = import.meta.env.VITE_TENANT_SLUG?.trim().toLowerCase() || null;
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

export type TenantResolutionSource = "route" | "host" | "dev-fallback" | "none";

export type TenantResolution = {
  slug: string | null;
  source: TenantResolutionSource;
  needsTenantHeader: boolean;
};

function normalizeHost(value: string): string {
  return value.trim().toLowerCase().replace(/:\d+$/, "");
}

function normalizeSlug(value: string): string {
  return value.trim().toLowerCase();
}

function isValidTenantSlug(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function isManagedDomainHost(host: string): boolean {
  if (!host || !TENANT_BASE_DOMAIN) {
    return false;
  }
  return host === TENANT_BASE_DOMAIN || host.endsWith(`.${TENANT_BASE_DOMAIN}`);
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
  if (!subdomain || subdomain.includes(".") || RESERVED_SUBDOMAINS.has(subdomain) || !isValidTenantSlug(subdomain)) {
    return null;
  }

  return subdomain;
}

export function extractTenantSlugFromPathname(pathname: string): string | null {
  const match = pathname.match(/^\/t\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/|$)/i);
  const slug = match?.[1];
  if (!slug) {
    return null;
  }
  return normalizeSlug(slug);
}

export function resolveBrowserTenantContext(): TenantResolution {
  if (typeof window === "undefined") {
    return DEFAULT_TENANT_SLUG ? { slug: DEFAULT_TENANT_SLUG, source: "dev-fallback", needsTenantHeader: true } : { slug: null, source: "none", needsTenantHeader: false };
  }

  const routeSlug = extractTenantSlugFromPathname(window.location.pathname);
  if (routeSlug) {
    return { slug: routeSlug, source: "route", needsTenantHeader: true };
  }

  const host = normalizeHost(window.location.hostname);
  if (host === "localhost" || host === "127.0.0.1") {
    return DEFAULT_TENANT_SLUG
      ? { slug: DEFAULT_TENANT_SLUG, source: "dev-fallback", needsTenantHeader: true }
      : { slug: null, source: "none", needsTenantHeader: false };
  }

  const hostSlug = extractTenantSlugFromBrowserHost(host);
  if (hostSlug) {
    return { slug: hostSlug, source: "host", needsTenantHeader: false };
  }

  return { slug: null, source: "none", needsTenantHeader: false };
}

export function resolveCurrentTenantSlug(): string | null {
  return resolveBrowserTenantContext().slug;
}

export function buildTenantScopedPath(slug: string, path = "/"): string {
  const normalizedSlug = normalizeSlug(slug);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  if (typeof window !== "undefined") {
    const host = normalizeHost(window.location.hostname);
    if (host !== "localhost" && host !== "127.0.0.1" && isManagedDomainHost(host)) {
      return normalizedPath;
    }
  }

  if (normalizedPath === "/") {
    return `/t/${normalizedSlug}`;
  }
  return `/t/${normalizedSlug}${normalizedPath}`;
}

export function buildTenantPublicUrl(slug: string): string {
  const normalizedSlug = normalizeSlug(slug);
  if (typeof window === "undefined") {
    return buildTenantScopedPath(normalizedSlug, "/");
  }

  const { hostname, protocol } = window.location;
  const normalizedHost = normalizeHost(hostname);
  if (hostname !== "localhost" && hostname !== "127.0.0.1" && isManagedDomainHost(normalizedHost)) {
    return `${protocol}//${normalizedSlug}.${TENANT_BASE_DOMAIN}/`;
  }

  return buildTenantScopedPath(normalizedSlug, "/");
}

export function buildTenantBookingUrl(slug: string): string {
  const publicUrl = buildTenantPublicUrl(slug);
  return `${publicUrl.replace(/\/$/, "")}#booking`;
}

export function buildTenantAppUrl(slug: string, path = "/app"): string {
  const normalizedSlug = normalizeSlug(slug);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (typeof window === "undefined") {
    return buildTenantScopedPath(normalizedSlug, normalizedPath);
  }

  const { hostname, protocol } = window.location;
  const normalizedHost = normalizeHost(hostname);
  if (hostname !== "localhost" && hostname !== "127.0.0.1" && isManagedDomainHost(normalizedHost)) {
    return `${protocol}//${normalizedSlug}.${TENANT_BASE_DOMAIN}${normalizedPath}`;
  }

  return buildTenantScopedPath(normalizedSlug, normalizedPath);
}
