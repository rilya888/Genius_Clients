import { httpJson } from "./http";

type PublicPricingEnvelope = {
  data: {
    items: Array<{
      code: string;
      name: string;
      priceCents: number;
      currency: string;
      billingPeriod: "month" | "year";
      isEnterprise: boolean;
      selfServe: boolean;
      contactRequired: boolean;
      stripeConfigured: boolean;
      features: string[];
    }>;
  };
};

export async function listPublicPricingPlans() {
  const payload = await httpJson<PublicPricingEnvelope>("/api/v1/marketing/pricing/plans", {
    method: "GET"
  });
  return payload.data.items;
}

export async function trackMarketingEvent(input: {
  event:
    | "landing_cta_start_free_click"
    | "landing_cta_enterprise_click"
    | "landing_pricing_plan_view"
    | "landing_whatsapp_flow_expand";
  payload?: Record<string, unknown>;
}) {
  try {
    await httpJson<void>("/api/v1/marketing/events", {
      method: "POST",
      body: JSON.stringify({
        event: input.event,
        payload: input.payload,
        path: typeof window !== "undefined" ? window.location.pathname : null
      })
    });
  } catch {
    // Tracking failures must never block product flows.
  }
}

