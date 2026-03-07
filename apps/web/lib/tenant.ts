const ROOT_DOMAIN = process.env.APP_ROOT_DOMAIN ?? "yourapp.com";

export type TenantResolution = {
  slug: string | null;
  isAppHost: boolean;
};

/**
 * Resolves tenant slug from host according to the BFF tenant model.
 */
export function resolveTenantFromHost(hostHeader: string | null): TenantResolution {
  if (!hostHeader) {
    return { slug: null, isAppHost: false };
  }

  const host = hostHeader.split(":")[0]?.toLowerCase() ?? "";
  const appHost = `app.${ROOT_DOMAIN}`;

  if (host === appHost) {
    return { slug: null, isAppHost: true };
  }

  const rootSuffix = `.${ROOT_DOMAIN}`;
  if (!host.endsWith(rootSuffix)) {
    return { slug: null, isAppHost: false };
  }

  const slug = host.slice(0, -rootSuffix.length);
  if (!slug || slug.includes(".")) {
    return { slug: null, isAppHost: false };
  }

  return { slug, isAppHost: false };
}
