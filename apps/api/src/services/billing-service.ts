import { appError } from "../lib/http";
import { getApiEnv } from "../lib/env";
import {
  AuditRepository,
  BillingRepository,
  StripeRepository,
  TenantRepository,
  UserRepository
} from "../repositories";

const ENTERPRISE_PLAN_CODE = "enterprise";
const BILLING_MUTATION_ACTION = "billing.subscription.change";

type BillingSubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "incomplete"
  | "scheduled"
  | "expired";

type BillingSummary = {
  planCode: string | null;
  pendingPlanCode: string | null;
  status: BillingSubscriptionStatus | null;
  trialEndsAt: string | null;
  trialDaysLeft: number;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  lastInvoiceStatus: string | null;
  billingState: "ok" | "past_due_warning" | "read_only" | "hard_locked";
  readOnlyActive: boolean;
  hardLockActive: boolean;
  daysPastDue: number;
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  return fallback;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function unixToDate(value: unknown): Date | null {
  const seconds = asNumber(value);
  if (seconds === null) {
    return null;
  }
  return new Date(Math.trunc(seconds) * 1000);
}

function toDateOrNull(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function getFutureDaysLeft(value: Date | null, now: Date): number {
  if (!value) {
    return 0;
  }
  return Math.max(0, Math.ceil((value.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));
}

export class BillingService {
  private readonly billingRepository = new BillingRepository();
  private readonly stripeRepository = new StripeRepository();
  private readonly tenantRepository = new TenantRepository();
  private readonly userRepository = new UserRepository();
  private readonly auditRepository = new AuditRepository();
  private readonly billingCheckoutEnabled = (process.env.BILLING_CHECKOUT_ENABLED ?? "false") === "true";
  private readonly billingTrialConfirmRequired =
    (process.env.BILLING_TRIAL_CONFIRM_REQUIRED ?? "true") === "true";
  private readonly billingPastDueReadOnlyAfterDays = Number(
    process.env.BILLING_PAST_DUE_READONLY_AFTER_DAYS ?? "3"
  );
  private readonly billingPastDueHardLockAfterDays = Number(
    process.env.BILLING_PAST_DUE_HARD_LOCK_AFTER_DAYS ?? "14"
  );
  private readonly billingDefaultCurrency = (process.env.BILLING_DEFAULT_CURRENCY ?? "eur")
    .trim()
    .toLowerCase();
  private readonly billingEnterpriseContactUrl =
    process.env.BILLING_ENTERPRISE_CONTACT_URL?.trim() || null;

  private getStripeSecretKey() {
    const value = process.env.STRIPE_SECRET_KEY?.trim();
    if (!value) {
      throw appError("INTERNAL_ERROR", { reason: "stripe_secret_key_missing" });
    }
    return value;
  }

  private async stripeRequest(input: {
    method: "GET" | "POST";
    path: string;
    form?: URLSearchParams;
  }): Promise<Record<string, unknown>> {
    const stripeSecretKey = this.getStripeSecretKey();
    const response = await fetch(`https://api.stripe.com/v1${input.path}`, {
      method: input.method,
      headers: {
        authorization: `Bearer ${stripeSecretKey}`,
        "content-type": "application/x-www-form-urlencoded"
      },
      body: input.form
    });

    const payload = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      const error = asRecord(asRecord(payload).error);
      throw appError("INTERNAL_ERROR", {
        reason: "stripe_request_failed",
        stripeStatus: response.status,
        stripeCode: asString(error.code),
        stripeType: asString(error.type),
        stripeMessage: asString(error.message)
      });
    }

    return asRecord(payload);
  }

  private buildReturnUrl(baseUrl: string | null, status: "success" | "cancel"): string {
    const fallbackBase = getApiEnv().appBaseUrl || "http://localhost:5173";
    const origin = baseUrl || fallbackBase;
    try {
      const url = new URL(`/app/settings?billing=${status}`, origin);
      return url.toString();
    } catch {
      return `${fallbackBase.replace(/\/+$/, "")}/app/settings?billing=${status}`;
    }
  }

  private extractBaseUrlFromOriginHeader(origin?: string | null): string | null {
    if (!origin) {
      return null;
    }
    try {
      const parsed = new URL(origin);
      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      return null;
    }
  }

  private mapBillingState(summary: {
    status: string | null;
    pastDueSince: Date | null;
    readOnlySince: Date | null;
    hardLockedSince: Date | null;
    now: Date;
  }): {
    state: BillingSummary["billingState"];
    readOnlyActive: boolean;
    hardLockActive: boolean;
    daysPastDue: number;
    readOnlySince: Date | null;
    hardLockedSince: Date | null;
  } {
    if (summary.status !== "past_due") {
      return {
        state: "ok",
        readOnlyActive: false,
        hardLockActive: false,
        daysPastDue: 0,
        readOnlySince: null,
        hardLockedSince: null
      };
    }

    const now = summary.now;
    const pastDueSince = summary.pastDueSince ?? now;
    const daysPastDue = Math.max(
      0,
      Math.floor((now.getTime() - pastDueSince.getTime()) / (24 * 60 * 60 * 1000))
    );
    const shouldReadOnly = daysPastDue >= this.billingPastDueReadOnlyAfterDays;
    const shouldHardLock = daysPastDue >= this.billingPastDueHardLockAfterDays;
    const readOnlySince = shouldReadOnly ? summary.readOnlySince ?? now : null;
    const hardLockedSince = shouldHardLock ? summary.hardLockedSince ?? now : null;

    if (shouldHardLock) {
      return {
        state: "hard_locked",
        readOnlyActive: true,
        hardLockActive: true,
        daysPastDue,
        readOnlySince,
        hardLockedSince
      };
    }
    if (shouldReadOnly) {
      return {
        state: "read_only",
        readOnlyActive: true,
        hardLockActive: false,
        daysPastDue,
        readOnlySince,
        hardLockedSince: null
      };
    }

    return {
      state: "past_due_warning",
      readOnlyActive: false,
      hardLockActive: false,
      daysPastDue,
      readOnlySince: null,
      hardLockedSince: null
    };
  }

  async listBillingPlans(tenantId: string) {
    const [plans, features] = await Promise.all([
      this.billingRepository.listCanonicalPlans(),
      this.billingRepository.listPlanFeatures()
    ]);
    const summary = await this.getBillingSubscriptionSummary(tenantId);
    const currentPlan = plans.find((item) => item.code === summary.planCode) ?? null;
    const featureMap = new Map<string, Record<string, unknown>>();

    for (const item of features) {
      if (!featureMap.has(item.planCode)) {
        featureMap.set(item.planCode, {});
      }
      const map = featureMap.get(item.planCode);
      if (map) {
        map[item.featureKey] = item.valueJson;
      }
    }

    return plans.map((item) => ({
      code: item.code,
      name: item.name,
      priceCents: item.priceCents,
      currency: item.currency,
      billingPeriod: item.billingPeriod,
      isActive: item.isActive,
      isCheckoutEnabled: item.isCheckoutEnabled,
      isEnterprise: item.code === ENTERPRISE_PLAN_CODE,
      stripeConfigured: Boolean(item.stripePriceIdMonthly),
      features: featureMap.get(item.code) ?? {},
      isCurrent: item.code === summary.planCode,
      canUpgrade:
        currentPlan === null
          ? item.code !== ENTERPRISE_PLAN_CODE
          : item.sortOrder > currentPlan.sortOrder && item.code !== ENTERPRISE_PLAN_CODE
    }));
  }

  async getBillingSubscriptionSummary(tenantId: string): Promise<BillingSummary> {
    const now = new Date();
    const row = await this.billingRepository.getLatestTenantSubscription(tenantId);
    if (!row) {
      return {
        planCode: null,
        pendingPlanCode: null,
        status: null,
        trialEndsAt: null,
        trialDaysLeft: 0,
        currentPeriodStart: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        lastInvoiceStatus: null,
        billingState: "ok",
        readOnlyActive: false,
        hardLockActive: false,
        daysPastDue: 0
      };
    }

    const pastDueSince = toDateOrNull(row.pastDueSince);
    const readOnlySince = toDateOrNull(row.readOnlySince);
    const hardLockedSince = toDateOrNull(row.hardLockedSince);
    const effectiveTo = toDateOrNull(row.effectiveTo);
    const currentPeriodStart = toDateOrNull(row.currentPeriodStart);
    const currentPeriodEnd = toDateOrNull(row.currentPeriodEnd);

    const lifecycle = this.mapBillingState({
      status: row.status,
      pastDueSince,
      readOnlySince,
      hardLockedSince,
      now
    });

    if (
      lifecycle.readOnlySince?.toISOString() !== readOnlySince?.toISOString() ||
      lifecycle.hardLockedSince?.toISOString() !== hardLockedSince?.toISOString()
    ) {
      await this.billingRepository.updateLifecycleMarkers({
        subscriptionId: row.id,
        readOnlySince: lifecycle.readOnlySince,
        hardLockedSince: lifecycle.hardLockedSince
      });
    }

    const trialEndsAtDate =
      row.status === "trialing" ? effectiveTo ?? currentPeriodEnd : null;
    return {
      planCode: row.planCode,
      pendingPlanCode: row.pendingPlanCode,
      status: row.status as BillingSubscriptionStatus,
      trialEndsAt: trialEndsAtDate?.toISOString() ?? null,
      trialDaysLeft: getFutureDaysLeft(trialEndsAtDate, now),
      currentPeriodStart: currentPeriodStart?.toISOString() ?? null,
      currentPeriodEnd: currentPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: row.cancelAtPeriodEnd,
      lastInvoiceStatus: row.lastInvoiceStatus,
      billingState: lifecycle.state,
      readOnlyActive: lifecycle.readOnlyActive,
      hardLockActive: lifecycle.hardLockActive,
      daysPastDue: lifecycle.daysPastDue
    };
  }

  async createCheckout(input: {
    tenantId: string;
    actorUserId: string;
    targetPlanCode: string;
    confirmedTrialOverride?: boolean;
    origin?: string | null;
  }): Promise<
    | {
        requiresTrialConfirm: true;
        trialDaysLeft: number;
      }
    | {
        requiresTrialConfirm: false;
        checkoutUrl: string;
        mode: "checkout_session";
      }
    | {
        requiresTrialConfirm: false;
        mode: "subscription_updated";
      }
  > {
    if (!this.billingCheckoutEnabled) {
      throw appError("AUTH_FORBIDDEN", { reason: "billing_checkout_disabled" });
    }

    const targetPlanCode = input.targetPlanCode.trim().toLowerCase();
    const targetPlan = await this.billingRepository.getPlanByCode(targetPlanCode);
    if (!targetPlan || !targetPlan.isActive) {
      throw appError("VALIDATION_ERROR", { reason: "target_plan_not_available" });
    }
    if (targetPlan.code === ENTERPRISE_PLAN_CODE || !targetPlan.isCheckoutEnabled) {
      throw appError("VALIDATION_ERROR", {
        reason: "enterprise_contact_required",
        contactUrl: this.billingEnterpriseContactUrl
      });
    }

    const [subscription, plans, tenant, actorUser] = await Promise.all([
      this.billingRepository.getLatestTenantSubscription(input.tenantId),
      this.billingRepository.listCanonicalPlans(),
      this.tenantRepository.findById(input.tenantId),
      this.userRepository.findById(input.actorUserId)
    ]);
    if (!tenant) {
      throw appError("TENANT_NOT_FOUND");
    }
    if (!actorUser || actorUser.tenantId !== input.tenantId) {
      throw appError("AUTH_FORBIDDEN", { reason: "actor_user_not_in_tenant" });
    }

    const currentPlan = subscription
      ? plans.find((plan) => plan.code === subscription.planCode) ?? null
      : null;
    if (currentPlan && targetPlan.sortOrder <= currentPlan.sortOrder) {
      throw appError("VALIDATION_ERROR", { reason: "upgrade_only" });
    }

    const now = new Date();
    if (
      this.billingTrialConfirmRequired &&
      !input.confirmedTrialOverride &&
      subscription?.status === "trialing"
    ) {
      const trialEnd = subscription.effectiveTo ?? subscription.currentPeriodEnd;
      const daysLeft = getFutureDaysLeft(trialEnd, now);
      if (daysLeft > 0) {
        return {
          requiresTrialConfirm: true,
          trialDaysLeft: daysLeft
        };
      }
    }

    if (!targetPlan.stripePriceIdMonthly) {
      throw appError("INTERNAL_ERROR", { reason: "target_plan_missing_stripe_price_id" });
    }
    if (targetPlan.currency.trim().toLowerCase() !== this.billingDefaultCurrency) {
      throw appError("INTERNAL_ERROR", {
        reason: "target_plan_currency_mismatch",
        expected: this.billingDefaultCurrency,
        actual: targetPlan.currency
      });
    }

    const customerId = await this.ensureStripeCustomer({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      email: actorUser.email,
      tenantSlug: tenant.slug
    });

    await this.billingRepository.markPendingImmediatePlanChange({
      tenantId: input.tenantId,
      targetPlanCode: targetPlan.code
    });

    const subscriptionId = subscription?.stripeSubscriptionId?.trim() ?? "";
    if (subscriptionId) {
      await this.updateStripeSubscriptionPrice({
        stripeSubscriptionId: subscriptionId,
        stripePriceIdMonthly: targetPlan.stripePriceIdMonthly,
        tenantId: input.tenantId,
        tenantSlug: tenant.slug,
        targetPlanCode: targetPlan.code
      });

      await this.auditRepository.create({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: BILLING_MUTATION_ACTION,
        entity: "tenant_subscription",
        meta: {
          mode: "subscription_updated",
          targetPlanCode: targetPlan.code,
          stripeSubscriptionId: subscriptionId
        }
      });

      return {
        requiresTrialConfirm: false,
        mode: "subscription_updated"
      };
    }

    const checkoutUrl = await this.createStripeCheckoutSession({
      stripeCustomerId: customerId,
      stripePriceIdMonthly: targetPlan.stripePriceIdMonthly,
      tenantId: input.tenantId,
      tenantSlug: tenant.slug,
      actorUserId: input.actorUserId,
      currentPlanCode: currentPlan?.code ?? null,
      targetPlanCode: targetPlan.code,
      origin: this.extractBaseUrlFromOriginHeader(input.origin)
    });

    await this.auditRepository.create({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: BILLING_MUTATION_ACTION,
      entity: "tenant_subscription",
      meta: {
        mode: "checkout_session",
        targetPlanCode: targetPlan.code,
        stripeCustomerId: customerId
      }
    });

    return {
      requiresTrialConfirm: false,
      checkoutUrl,
      mode: "checkout_session"
    };
  }

  private async ensureStripeCustomer(input: {
    tenantId: string;
    actorUserId: string;
    email: string;
    tenantSlug: string;
  }): Promise<string> {
    const existing = await this.stripeRepository.listByTenant(input.tenantId, 1);
    const first = existing[0];
    if (first?.stripeCustomerId) {
      return first.stripeCustomerId;
    }

    const form = new URLSearchParams();
    form.set("email", input.email);
    form.set("metadata[tenant_id]", input.tenantId);
    form.set("metadata[user_id]", input.actorUserId);
    form.set("metadata[tenant_slug]", input.tenantSlug);
    form.set("metadata[source]", "genius_clients_api");
    const payload = await this.stripeRequest({
      method: "POST",
      path: "/customers",
      form
    });

    const stripeCustomerId = asString(payload.id);
    if (!stripeCustomerId) {
      throw appError("INTERNAL_ERROR", { reason: "stripe_customer_create_invalid_response" });
    }

    await this.stripeRepository.upsertCustomer({
      tenantId: input.tenantId,
      stripeCustomerId,
      email: input.email,
      userId: input.actorUserId
    });

    return stripeCustomerId;
  }

  private async createStripeCheckoutSession(input: {
    stripeCustomerId: string;
    stripePriceIdMonthly: string;
    tenantId: string;
    tenantSlug: string;
    actorUserId: string;
    currentPlanCode: string | null;
    targetPlanCode: string;
    origin: string | null;
  }): Promise<string> {
    const form = new URLSearchParams();
    form.set("mode", "subscription");
    form.set("customer", input.stripeCustomerId);
    form.set("line_items[0][price]", input.stripePriceIdMonthly);
    form.set("line_items[0][quantity]", "1");
    form.set("success_url", this.buildReturnUrl(input.origin, "success"));
    form.set("cancel_url", this.buildReturnUrl(input.origin, "cancel"));
    form.set("allow_promotion_codes", "true");
    form.set("client_reference_id", input.tenantId);
    form.set("metadata[tenant_id]", input.tenantId);
    form.set("metadata[user_id]", input.actorUserId);
    form.set("metadata[tenant_slug]", input.tenantSlug);
    form.set("metadata[target_plan_code]", input.targetPlanCode);
    form.set("metadata[current_plan_code]", input.currentPlanCode ?? "");
    form.set("subscription_data[metadata][tenant_id]", input.tenantId);
    form.set("subscription_data[metadata][tenant_slug]", input.tenantSlug);
    form.set("subscription_data[metadata][target_plan_code]", input.targetPlanCode);

    const payload = await this.stripeRequest({
      method: "POST",
      path: "/checkout/sessions",
      form
    });

    const checkoutUrl = asString(payload.url);
    if (!checkoutUrl) {
      throw appError("INTERNAL_ERROR", { reason: "stripe_checkout_url_missing" });
    }
    return checkoutUrl;
  }

  private async updateStripeSubscriptionPrice(input: {
    stripeSubscriptionId: string;
    stripePriceIdMonthly: string;
    tenantId: string;
    tenantSlug: string;
    targetPlanCode: string;
  }): Promise<void> {
    const existing = await this.stripeRequest({
      method: "GET",
      path: `/subscriptions/${encodeURIComponent(input.stripeSubscriptionId)}`
    });
    const items = asRecord(asRecord(existing.items));
    const itemData = Array.isArray(items.data) ? items.data : [];
    const firstItem = asRecord(itemData[0]);
    const itemId = asString(firstItem.id);
    if (!itemId) {
      throw appError("INTERNAL_ERROR", {
        reason: "stripe_subscription_item_not_found",
        stripeSubscriptionId: input.stripeSubscriptionId
      });
    }

    const form = new URLSearchParams();
    form.set("items[0][id]", itemId);
    form.set("items[0][price]", input.stripePriceIdMonthly);
    form.set("proration_behavior", "always_invoice");
    form.set("metadata[tenant_id]", input.tenantId);
    form.set("metadata[tenant_slug]", input.tenantSlug);
    form.set("metadata[target_plan_code]", input.targetPlanCode);
    await this.stripeRequest({
      method: "POST",
      path: `/subscriptions/${encodeURIComponent(input.stripeSubscriptionId)}`,
      form
    });
  }

  async applyStripeSubscriptionEvent(input: {
    eventType: string;
    payloadJson: unknown;
  }): Promise<{ tenantId: string | null; applied: boolean; reason?: string }> {
    const payload = asRecord(input.payloadJson);
    const object = asRecord(asRecord(payload.data).object);
    const metadata = asRecord(object.metadata);
    const customerIdFromObject = asString(object.customer);
    const tenantIdFromMetadata = asString(metadata.tenant_id);
    const tenantIdFromCustomer = customerIdFromObject
      ? (await this.stripeRepository.findByStripeCustomerId(customerIdFromObject))?.tenantId ?? null
      : null;
    const tenantId = tenantIdFromMetadata ?? tenantIdFromCustomer;

    if (!tenantId) {
      return { tenantId: null, applied: false, reason: "missing_tenant_id" };
    }

    let subscriptionObject =
      input.eventType.startsWith("customer.subscription.")
        ? object
        : asRecord(asRecord(payload.data).object);
    if (input.eventType.startsWith("invoice.payment")) {
      const subscriptionIdFromInvoice = asString(object.subscription);
      if (subscriptionIdFromInvoice) {
        subscriptionObject = await this.stripeRequest({
          method: "GET",
          path: `/subscriptions/${encodeURIComponent(subscriptionIdFromInvoice)}`
        });
      }
    }
    const checkoutSubscriptionId =
      input.eventType.startsWith("checkout.session.")
        ? asString(object.subscription)
        : null;
    const subscriptionId = checkoutSubscriptionId ?? asString(subscriptionObject.id);
    const stripeCustomerId =
      asString(subscriptionObject.customer) ?? asString(object.customer) ?? customerIdFromObject;
    const statusRaw = asString(subscriptionObject.status) ?? "active";
    const stripeStatus = this.mapStripeStatus(statusRaw);

    let planCode = asString(asRecord(subscriptionObject.metadata).target_plan_code)
      ?? asString(metadata.target_plan_code);

    if (!planCode) {
      const planByPrice = await this.resolvePlanCodeFromSubscriptionObject(subscriptionObject);
      planCode = planByPrice;
    }

    if (!planCode) {
      return { tenantId, applied: false, reason: "plan_code_not_resolved" };
    }

    const currentPeriodStart = unixToDate(subscriptionObject.current_period_start);
    const currentPeriodEnd = unixToDate(subscriptionObject.current_period_end);
    const cancelAtPeriodEnd = asBoolean(subscriptionObject.cancel_at_period_end, false);
    const latest = await this.billingRepository.getLatestTenantSubscription(tenantId);
    const pastDueSince = stripeStatus === "past_due" ? latest?.pastDueSince ?? new Date() : null;
    const lifecycle = this.mapBillingState({
      status: stripeStatus,
      pastDueSince,
      readOnlySince: latest?.readOnlySince ?? null,
      hardLockedSince: latest?.hardLockedSince ?? null,
      now: new Date()
    });

    await this.billingRepository.applyStripeSubscriptionState({
      tenantId,
      planCode,
      status: stripeStatus,
      stripeSubscriptionId: subscriptionId,
      stripeCustomerId,
      cancelAtPeriodEnd,
      currentPeriodStart,
      currentPeriodEnd,
      lastInvoiceStatus:
        input.eventType === "invoice.payment_succeeded"
          ? "paid"
          : input.eventType === "invoice.payment_failed"
            ? "failed"
            : latest?.lastInvoiceStatus ?? null,
      pastDueSince,
      readOnlySince: lifecycle.readOnlySince,
      hardLockedSince: lifecycle.hardLockedSince
    });

    return { tenantId, applied: true };
  }

  private mapStripeStatus(status: string): BillingSubscriptionStatus {
    switch (status) {
      case "trialing":
        return "trialing";
      case "active":
        return "active";
      case "past_due":
        return "past_due";
      case "incomplete":
      case "incomplete_expired":
        return "incomplete";
      case "canceled":
      case "unpaid":
        return "canceled";
      case "scheduled":
        return "scheduled";
      case "expired":
        return "expired";
      default:
        return "active";
    }
  }

  private async resolvePlanCodeFromSubscriptionObject(
    subscriptionObject: Record<string, unknown>
  ): Promise<string | null> {
    const items = asRecord(subscriptionObject.items);
    const data = Array.isArray(items.data) ? items.data : [];
    const firstItem = asRecord(data[0]);
    const price = asRecord(firstItem.price);
    const priceId = asString(price.id);
    if (!priceId) {
      return null;
    }
    const plan = await this.billingRepository.getPlanByStripePriceIdMonthly(priceId);
    return plan?.code ?? null;
  }
}
