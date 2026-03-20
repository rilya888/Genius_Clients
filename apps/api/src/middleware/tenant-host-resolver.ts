import type { Context, Next } from "hono";
import { extractTenantSlugFromHost, normalizeHost } from "@genius/shared";
import type { ApiAppEnv } from "../lib/hono-env";
import { getApiEnv } from "../lib/env";
import { TenantRepository } from "../repositories";

const tenantRepository = new TenantRepository();
const UUID_V4_OR_V7_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function tenantHostResolverMiddleware(c: Context<ApiAppEnv>, next: Next) {
  const existingTenantId = c.get("tenantId");
  if (existingTenantId && UUID_V4_OR_V7_REGEX.test(existingTenantId)) {
    if (!c.get("tenantResolverSource")) {
      c.set("tenantResolverSource", "existing");
    }
    await next();
    return;
  }

  const env = getApiEnv();
  const requestHost =
    (env.tenantTrustForwardedHost ? normalizeHost(c.req.header("x-forwarded-host")) : null) ??
    normalizeHost(c.req.header("host"));
  if (requestHost) {
    c.set("requestHost", requestHost);
  }

  if (!env.tenantHostResolutionEnabled) {
    if (!c.get("tenantResolverSource")) {
      c.set("tenantResolverSource", "disabled");
    }
    await next();
    return;
  }

  const tenantSlug = requestHost ? extractTenantSlugFromHost(requestHost, env.tenantBaseDomain) : null;
  if (!tenantSlug) {
    if (!c.get("tenantResolverSource")) {
      c.set("tenantResolverSource", "host_no_match");
    }
    await next();
    return;
  }

  const tenant = await tenantRepository.findBySlug(tenantSlug);
  if (!tenant) {
    c.set("resolvedTenantSlug", tenantSlug);
    c.set("tenantResolverSource", "host_tenant_not_found");
    console.warn("[api] tenant host slug not found", {
      requestId: c.get("requestId"),
      requestHost,
      resolvedTenantSlug: tenantSlug,
      resolverSource: "host_tenant_not_found"
    });
    await next();
    return;
  }

  c.set("tenantId", tenant.id);
  c.set("resolvedTenantSlug", tenant.slug);
  c.set("tenantResolverSource", "host");
  await next();
}
