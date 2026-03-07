import type { Context, Next } from "hono";
import { appError } from "../lib/http";
import type { ApiAppEnv } from "../lib/hono-env";
import { TenantRepository } from "../repositories";

const tenantRepository = new TenantRepository();
const UUID_V4_OR_V7_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function tenantContextMiddleware(c: Context<ApiAppEnv>, next: Next) {
  const tenantId = c.req.header("x-internal-tenant-id");
  const tenantSlug = c.req.header("x-internal-tenant-slug");

  if (tenantId && UUID_V4_OR_V7_REGEX.test(tenantId)) {
    c.set("tenantId", tenantId);
    await next();
    return;
  }

  if (tenantSlug) {
    const tenant = await tenantRepository.findBySlug(tenantSlug);
    if (!tenant) {
      throw appError("TENANT_NOT_FOUND", { reason: "tenant slug was not found" });
    }

    c.set("tenantId", tenant.id);
    await next();
    return;
  }

  throw appError("TENANT_NOT_FOUND", {
    reason: "x-internal-tenant-id (uuid) or x-internal-tenant-slug is required"
  });
}
