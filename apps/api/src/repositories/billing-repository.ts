import { sql } from "drizzle-orm";
import { getDb } from "../lib/db";

export type BillingPlanRow = {
  id: string;
  code: string;
  name: string;
  priceCents: number;
  currency: string;
  billingPeriod: "month" | "year";
  isActive: boolean;
  sortOrder: number;
  isCheckoutEnabled: boolean;
  stripeProductId: string | null;
  stripePriceIdMonthly: string | null;
};

export type BillingPlanFeatureRow = {
  planCode: string;
  featureKey: string;
  valueJson: unknown;
};

export type TenantSubscriptionRow = {
  id: string;
  tenantId: string;
  planCode: string;
  pendingPlanCode: string | null;
  status: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  billingCycleAnchor: Date | null;
  changeMode: string;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  pastDueSince: Date | null;
  readOnlySince: Date | null;
  hardLockedSince: Date | null;
  lastInvoiceStatus: string | null;
  updatedAt: Date;
};

const CANONICAL_PLAN_CODES = ["starter", "pro", "business", "enterprise"] as const;

export class BillingRepository {
  async listCanonicalPlans(): Promise<BillingPlanRow[]> {
    const db = getDb();
    const result = await db.execute<BillingPlanRow>(sql`
      SELECT
        p.id,
        p.code,
        p.name,
        p.price_cents AS "priceCents",
        p.currency,
        p.billing_period AS "billingPeriod",
        p.is_active AS "isActive",
        p.sort_order AS "sortOrder",
        COALESCE(cfg.is_checkout_enabled, FALSE) AS "isCheckoutEnabled",
        cfg.stripe_product_id AS "stripeProductId",
        cfg.stripe_price_id_monthly AS "stripePriceIdMonthly"
      FROM subscription_plans p
      LEFT JOIN subscription_plan_billing_config cfg
        ON cfg.plan_code = p.code
      WHERE p.code = ANY (${CANONICAL_PLAN_CODES}::text[])
      ORDER BY p.sort_order ASC, p.code ASC
    `);

    return result.rows as unknown as BillingPlanRow[];
  }

  async getPlanByCode(planCode: string): Promise<BillingPlanRow | null> {
    const db = getDb();
    const result = await db.execute<BillingPlanRow>(sql`
      SELECT
        p.id,
        p.code,
        p.name,
        p.price_cents AS "priceCents",
        p.currency,
        p.billing_period AS "billingPeriod",
        p.is_active AS "isActive",
        p.sort_order AS "sortOrder",
        COALESCE(cfg.is_checkout_enabled, FALSE) AS "isCheckoutEnabled",
        cfg.stripe_product_id AS "stripeProductId",
        cfg.stripe_price_id_monthly AS "stripePriceIdMonthly"
      FROM subscription_plans p
      LEFT JOIN subscription_plan_billing_config cfg
        ON cfg.plan_code = p.code
      WHERE p.code = ${planCode}
      LIMIT 1
    `);

    return (result.rows[0] as BillingPlanRow | undefined) ?? null;
  }

  async getPlanByStripePriceIdMonthly(priceId: string): Promise<BillingPlanRow | null> {
    const db = getDb();
    const result = await db.execute<BillingPlanRow>(sql`
      SELECT
        p.id,
        p.code,
        p.name,
        p.price_cents AS "priceCents",
        p.currency,
        p.billing_period AS "billingPeriod",
        p.is_active AS "isActive",
        p.sort_order AS "sortOrder",
        COALESCE(cfg.is_checkout_enabled, FALSE) AS "isCheckoutEnabled",
        cfg.stripe_product_id AS "stripeProductId",
        cfg.stripe_price_id_monthly AS "stripePriceIdMonthly"
      FROM subscription_plans p
      INNER JOIN subscription_plan_billing_config cfg
        ON cfg.plan_code = p.code
      WHERE cfg.stripe_price_id_monthly = ${priceId}
      LIMIT 1
    `);

    return (result.rows[0] as BillingPlanRow | undefined) ?? null;
  }

  async listPlanFeatures(): Promise<BillingPlanFeatureRow[]> {
    const db = getDb();
    const result = await db.execute<BillingPlanFeatureRow>(sql`
      SELECT
        p.code AS "planCode",
        f.feature_key AS "featureKey",
        f.value_json AS "valueJson"
      FROM subscription_plan_features f
      INNER JOIN subscription_plans p ON p.id = f.plan_id
      WHERE p.code = ANY (${CANONICAL_PLAN_CODES}::text[])
      ORDER BY p.sort_order ASC, f.feature_key ASC
    `);
    return result.rows as unknown as BillingPlanFeatureRow[];
  }

  async getLatestTenantSubscription(tenantId: string): Promise<TenantSubscriptionRow | null> {
    const db = getDb();
    const result = await db.execute<TenantSubscriptionRow>(sql`
      SELECT
        id,
        tenant_id AS "tenantId",
        plan_code AS "planCode",
        pending_plan_code AS "pendingPlanCode",
        status,
        effective_from AS "effectiveFrom",
        effective_to AS "effectiveTo",
        billing_cycle_anchor AS "billingCycleAnchor",
        change_mode AS "changeMode",
        stripe_subscription_id AS "stripeSubscriptionId",
        stripe_customer_id AS "stripeCustomerId",
        cancel_at_period_end AS "cancelAtPeriodEnd",
        current_period_start AS "currentPeriodStart",
        current_period_end AS "currentPeriodEnd",
        past_due_since AS "pastDueSince",
        read_only_since AS "readOnlySince",
        hard_locked_since AS "hardLockedSince",
        last_invoice_status AS "lastInvoiceStatus",
        updated_at AS "updatedAt"
      FROM tenant_subscriptions
      WHERE tenant_id = ${tenantId}
      ORDER BY updated_at DESC
      LIMIT 1
    `);

    return (result.rows[0] as TenantSubscriptionRow | undefined) ?? null;
  }

  async markPendingImmediatePlanChange(input: {
    tenantId: string;
    targetPlanCode: string;
  }): Promise<void> {
    const db = getDb();
    const current = await this.getLatestTenantSubscription(input.tenantId);
    if (!current) {
      const now = new Date();
      await db.execute(sql`
        INSERT INTO tenant_subscriptions (
          tenant_id,
          plan_code,
          pending_plan_code,
          effective_from,
          status,
          billing_cycle_anchor,
          change_mode,
          created_at,
          updated_at
        ) VALUES (
          ${input.tenantId},
          ${input.targetPlanCode},
          ${input.targetPlanCode},
          ${now},
          'scheduled',
          ${now},
          'immediate_prorate',
          NOW(),
          NOW()
        )
      `);
      return;
    }

    await db.execute(sql`
      UPDATE tenant_subscriptions
      SET
        pending_plan_code = ${input.targetPlanCode},
        change_mode = 'immediate_prorate',
        updated_at = NOW()
      WHERE id = ${current.id}
    `);
  }

  async applyStripeSubscriptionState(input: {
    tenantId: string;
    planCode: string;
    status: string;
    stripeSubscriptionId: string | null;
    stripeCustomerId: string | null;
    cancelAtPeriodEnd: boolean;
    currentPeriodStart: Date | null;
    currentPeriodEnd: Date | null;
    lastInvoiceStatus: string | null;
    pastDueSince: Date | null;
    readOnlySince: Date | null;
    hardLockedSince: Date | null;
  }): Promise<TenantSubscriptionRow> {
    const db = getDb();
    const now = new Date();

    return db.transaction(async (tx) => {
      const latestResult = await tx.execute<TenantSubscriptionRow>(sql`
        SELECT
          id,
          tenant_id AS "tenantId",
          plan_code AS "planCode",
          pending_plan_code AS "pendingPlanCode",
          status,
          effective_from AS "effectiveFrom",
          effective_to AS "effectiveTo",
          billing_cycle_anchor AS "billingCycleAnchor",
          change_mode AS "changeMode",
          stripe_subscription_id AS "stripeSubscriptionId",
          stripe_customer_id AS "stripeCustomerId",
          cancel_at_period_end AS "cancelAtPeriodEnd",
          current_period_start AS "currentPeriodStart",
          current_period_end AS "currentPeriodEnd",
          past_due_since AS "pastDueSince",
          read_only_since AS "readOnlySince",
          hard_locked_since AS "hardLockedSince",
          last_invoice_status AS "lastInvoiceStatus",
          updated_at AS "updatedAt"
        FROM tenant_subscriptions
        WHERE tenant_id = ${input.tenantId}
        ORDER BY updated_at DESC
        LIMIT 1
      `);
      const latest = (latestResult.rows[0] as TenantSubscriptionRow | undefined) ?? null;

      if (!latest) {
        const inserted = await tx.execute<TenantSubscriptionRow>(sql`
          INSERT INTO tenant_subscriptions (
            tenant_id,
            plan_code,
            pending_plan_code,
            effective_from,
            effective_to,
            status,
            billing_cycle_anchor,
            change_mode,
            stripe_subscription_id,
            stripe_customer_id,
            cancel_at_period_end,
            current_period_start,
            current_period_end,
            last_invoice_status,
            past_due_since,
            read_only_since,
            hard_locked_since,
            created_at,
            updated_at
          ) VALUES (
            ${input.tenantId},
            ${input.planCode},
            NULL,
            ${now},
            ${input.currentPeriodEnd},
            ${input.status},
            ${input.currentPeriodStart ?? now},
            'immediate_prorate',
            ${input.stripeSubscriptionId},
            ${input.stripeCustomerId},
            ${input.cancelAtPeriodEnd},
            ${input.currentPeriodStart},
            ${input.currentPeriodEnd},
            ${input.lastInvoiceStatus},
            ${input.pastDueSince},
            ${input.readOnlySince},
            ${input.hardLockedSince},
            NOW(),
            NOW()
          )
          RETURNING
            id,
            tenant_id AS "tenantId",
            plan_code AS "planCode",
            pending_plan_code AS "pendingPlanCode",
            status,
            effective_from AS "effectiveFrom",
            effective_to AS "effectiveTo",
            billing_cycle_anchor AS "billingCycleAnchor",
            change_mode AS "changeMode",
            stripe_subscription_id AS "stripeSubscriptionId",
            stripe_customer_id AS "stripeCustomerId",
            cancel_at_period_end AS "cancelAtPeriodEnd",
            current_period_start AS "currentPeriodStart",
            current_period_end AS "currentPeriodEnd",
            past_due_since AS "pastDueSince",
            read_only_since AS "readOnlySince",
            hard_locked_since AS "hardLockedSince",
            last_invoice_status AS "lastInvoiceStatus",
            updated_at AS "updatedAt"
        `);
        return inserted.rows[0] as unknown as TenantSubscriptionRow;
      }

      const updated = await tx.execute<TenantSubscriptionRow>(sql`
        UPDATE tenant_subscriptions
        SET
          plan_code = ${input.planCode},
          pending_plan_code = NULL,
          status = ${input.status},
          effective_to = ${input.currentPeriodEnd},
          billing_cycle_anchor = COALESCE(${input.currentPeriodStart}, billing_cycle_anchor, NOW()),
          change_mode = 'immediate_prorate',
          stripe_subscription_id = ${input.stripeSubscriptionId},
          stripe_customer_id = ${input.stripeCustomerId},
          cancel_at_period_end = ${input.cancelAtPeriodEnd},
          current_period_start = ${input.currentPeriodStart},
          current_period_end = ${input.currentPeriodEnd},
          last_invoice_status = ${input.lastInvoiceStatus},
          past_due_since = ${input.pastDueSince},
          read_only_since = ${input.readOnlySince},
          hard_locked_since = ${input.hardLockedSince},
          updated_at = NOW()
        WHERE id = ${latest.id}
        RETURNING
          id,
          tenant_id AS "tenantId",
          plan_code AS "planCode",
          pending_plan_code AS "pendingPlanCode",
          status,
          effective_from AS "effectiveFrom",
          effective_to AS "effectiveTo",
          billing_cycle_anchor AS "billingCycleAnchor",
          change_mode AS "changeMode",
          stripe_subscription_id AS "stripeSubscriptionId",
          stripe_customer_id AS "stripeCustomerId",
          cancel_at_period_end AS "cancelAtPeriodEnd",
          current_period_start AS "currentPeriodStart",
          current_period_end AS "currentPeriodEnd",
          past_due_since AS "pastDueSince",
          read_only_since AS "readOnlySince",
          hard_locked_since AS "hardLockedSince",
          last_invoice_status AS "lastInvoiceStatus",
          updated_at AS "updatedAt"
      `);

      return updated.rows[0] as unknown as TenantSubscriptionRow;
    });
  }

  async listCanonicalPlanCodes(): Promise<string[]> {
    const plans = await this.listCanonicalPlans();
    return plans.map((item) => item.code);
  }

  async updateLifecycleMarkers(input: {
    subscriptionId: string;
    readOnlySince: Date | null;
    hardLockedSince: Date | null;
  }): Promise<void> {
    const db = getDb();
    await db.execute(sql`
      UPDATE tenant_subscriptions
      SET
        read_only_since = ${input.readOnlySince},
        hard_locked_since = ${input.hardLockedSince},
        updated_at = NOW()
      WHERE id = ${input.subscriptionId}
    `);
  }
}
