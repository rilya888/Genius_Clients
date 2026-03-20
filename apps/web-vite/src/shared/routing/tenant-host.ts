const TENANT_BASE_DOMAIN = (import.meta.env.VITE_TENANT_BASE_DOMAIN ?? "geniusclients.info").trim().toLowerCase();

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
