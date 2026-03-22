import { BillingRepository } from "../repositories";

const ENTERPRISE_PLAN_CODE = "enterprise";

export class MarketingService {
  private readonly billingRepository = new BillingRepository();

  async listPublicPricingPlans() {
    const [plans, features] = await Promise.all([
      this.billingRepository.listCanonicalPlans(),
      this.billingRepository.listPlanFeatures()
    ]);

    const featureMap = new Map<string, string[]>();
    for (const item of features) {
      const bucket = featureMap.get(item.planCode) ?? [];
      if (typeof item.valueJson === "string") {
        bucket.push(item.valueJson);
      } else if (item.valueJson !== null && item.valueJson !== undefined) {
        bucket.push(String(item.valueJson));
      }
      featureMap.set(item.planCode, bucket);
    }

    return plans.map((plan) => ({
      code: plan.code,
      name: plan.name,
      priceCents: plan.priceCents,
      currency: plan.currency,
      billingPeriod: plan.billingPeriod,
      isEnterprise: plan.code === ENTERPRISE_PLAN_CODE,
      selfServe: plan.code !== ENTERPRISE_PLAN_CODE && plan.isCheckoutEnabled,
      contactRequired: plan.code === ENTERPRISE_PLAN_CODE,
      stripeConfigured: Boolean(plan.stripePriceIdMonthly),
      features: featureMap.get(plan.code) ?? []
    }));
  }

  async captureMarketingEvent(input: {
    event: string;
    payload?: Record<string, unknown>;
    path?: string;
    userAgent?: string | null;
    ip?: string | null;
  }) {
    const event = input.event.trim().toLowerCase();
    if (!event) {
      return;
    }

    console.info("[marketing-event]", {
      event,
      path: input.path ?? null,
      userAgent: input.userAgent ?? null,
      ip: input.ip ?? null,
      payload: input.payload ?? {}
    });
  }
}

