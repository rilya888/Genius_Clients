import { Hono } from "hono";
import { appError } from "../../lib/http";
import { internalAuthMiddleware } from "../../middleware/internal-auth";
import { SuperAdminChannelEndpointRepository } from "../../repositories/super-admin/channel-endpoint-repository";

const channelEndpointRepository = new SuperAdminChannelEndpointRepository();

export const enterpriseV2Routes = new Hono()
  .use("/*", internalAuthMiddleware)
  .post("/channel-routing/resolve", async (c) => {
    const body = await c.req.json<{
      provider?: string;
      externalEndpointId?: string;
    }>();

    const provider = body.provider?.trim().toLowerCase();
    const externalEndpointId = body.externalEndpointId?.trim();
    if (!provider || !externalEndpointId) {
      throw appError("VALIDATION_ERROR", { required: ["provider", "externalEndpointId"] });
    }

    const route = await channelEndpointRepository.resolveActiveRoute({
      provider,
      externalEndpointId
    });
    if (!route) {
      return c.json({ error: { code: "NOT_FOUND", message: "Routing context not found" } }, 404);
    }

    return c.json({
      data: {
        accountId: route.accountId,
        salonId: route.salonId,
        externalEndpointId: route.externalEndpointId,
        tenantId: route.tenantId,
        tenantSlug: route.tenantSlug
      }
    });
  });
