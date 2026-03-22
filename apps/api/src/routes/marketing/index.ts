import { Hono } from "hono";
import type { ApiAppEnv } from "../../lib/hono-env";
import { appError } from "../../lib/http";
import { MarketingService } from "../../services";

const marketingService = new MarketingService();
const allowedMarketingEvents = new Set([
  "landing_cta_start_free_click",
  "landing_cta_enterprise_click",
  "landing_pricing_plan_view",
  "landing_whatsapp_flow_expand"
]);

export const marketingRoutes = new Hono<ApiAppEnv>()
  .get("/pricing/plans", async (c) => {
    const items = await marketingService.listPublicPricingPlans();
    return c.json({ data: { items } });
  })
  .post("/events", async (c) => {
    const body = (await c.req
      .json<{
        event?: string;
        payload?: Record<string, unknown>;
        path?: string;
      }>()
      .catch(() => ({} as { event?: string; payload?: Record<string, unknown>; path?: string }))) as {
      event?: string;
      payload?: Record<string, unknown>;
      path?: string;
    };

    const event = body.event?.trim().toLowerCase();
    if (!event) {
      throw appError("VALIDATION_ERROR", { required: ["event"] });
    }
    if (!allowedMarketingEvents.has(event)) {
      throw appError("VALIDATION_ERROR", { reason: "marketing_event_not_allowed" });
    }

    await marketingService.captureMarketingEvent({
      event,
      payload: body.payload,
      path: body.path,
      userAgent: c.req.header("user-agent"),
      ip: c.req.header("x-forwarded-for") ?? null
    });
    return c.body(null, 204);
  });
