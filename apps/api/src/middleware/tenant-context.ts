import type { Context, Next } from "hono";
import { extractTenantSlugFromHost } from "@genius/shared";
import { appError } from "../lib/http";
import type { ApiAppEnv } from "../lib/hono-env";
import { getApiEnv } from "../lib/env";
import { TenantRepository } from "../repositories";

const tenantRepository = new TenantRepository();
const UUID_V4_OR_V7_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function tenantContextMiddleware(c: Context<ApiAppEnv>, next: Next) {
  const env = getApiEnv();
  const existingTenantId = c.get("tenantId");
  if (existingTenantId && UUID_V4_OR_V7_REGEX.test(existingTenantId)) {
    if (!c.get("tenantResolverSource")) {
      c.set("tenantResolverSource", "existing");
    }
    await next();
    return;
  }

  const tenantId = c.req.header("x-internal-tenant-id");
  const tenantSlug = c.req.header("x-internal-tenant-slug");
  const providedInternalSecret = c.req.header("x-internal-secret");
  const isInternalRequest =
    typeof providedInternalSecret === "string" && providedInternalSecret === env.internalApiSecret;
  const requestHost = c.get("requestHost");
  const hostTenantSlug = requestHost
    ? extractTenantSlugFromHost(requestHost, env.tenantBaseDomain)
    : null;

  if ((tenantId || tenantSlug) && !isInternalRequest && !env.tenantBrowserHeaderFallbackEnabled) {
    throw appError("TENANT_NOT_FOUND", {
      reason: "browser tenant headers are disabled; use tenant host resolution"
    });
  }

  if (tenantId && UUID_V4_OR_V7_REGEX.test(tenantId)) {
    if (!isInternalRequest && hostTenantSlug) {
      throw appError("AUTH_FORBIDDEN", {
        reason: "tenant id header is not allowed on tenant host requests"
      });
    }
    c.set("tenantId", tenantId);
    c.set("tenantResolverSource", isInternalRequest ? "header_id_internal" : "header_id_browser");
    await next();
    return;
  }

  if (tenantSlug) {
    if (!isInternalRequest && hostTenantSlug && hostTenantSlug !== tenantSlug) {
      throw appError("AUTH_FORBIDDEN", {
        reason: "tenant slug header does not match tenant host"
      });
    }
    const tenant = await tenantRepository.findBySlug(tenantSlug);
    if (!tenant) {
      throw appError("TENANT_NOT_FOUND", { reason: "tenant slug was not found" });
    }

    c.set("tenantId", tenant.id);
    c.set("resolvedTenantSlug", tenant.slug);
    c.set("tenantResolverSource", isInternalRequest ? "header_slug_internal" : "header_slug_browser");
    await next();
    return;
  }

  throw appError("TENANT_NOT_FOUND", {
    reason: "x-internal-tenant-id (uuid) or x-internal-tenant-slug is required"
  });
}
