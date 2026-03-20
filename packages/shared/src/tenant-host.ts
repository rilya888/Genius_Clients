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

export function normalizeHost(value: string | undefined | null): string | null {
  if (!value) {
    return null;
  }
  const first = String(value).split(",")[0]?.trim().toLowerCase();
  if (!first) {
    return null;
  }
  return first.replace(/:\d+$/, "");
}

export function extractTenantSlugFromHost(hostname: string, baseDomain: string): string | null {
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
