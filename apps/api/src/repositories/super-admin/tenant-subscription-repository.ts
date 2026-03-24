import { sql, type SQL } from "drizzle-orm";
import { getDb } from "../../lib/db";

export type SuperAdminTenantOverviewRow = {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  desiredWhatsappBotE164: string | null;
  operatorWhatsappE164: string | null;
  subscriptionId: string | null;
  planCode: string | null;
  pendingPlanCode: string | null;
  status: string | null;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  billingCycleAnchor: Date | null;
  changeMode: string | null;
};

export type SuperAdminTenantSubscriptionRow = {
  id: string;
  tenantId: string;
  planCode: string;
  pendingPlanCode: string | null;
  status: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  billingCycleAnchor: Date | null;
  changeMode: string;
};

export class SuperAdminTenantSubscriptionRepository {
  async tenantExists(tenantId: string): Promise<boolean> {
    const db = getDb();
    const result = await db.execute<{ ok: number }>(sql`
      SELECT 1 AS ok
      FROM tenants
      WHERE id = ${tenantId}
      LIMIT 1
    `);

    return Boolean(result.rows[0]?.ok);
  }

  async listTenantsOverview(input?: {
    limit?: number;
    query?: string | null;
    planCode?: string | null;
  }): Promise<SuperAdminTenantOverviewRow[]> {
    const db = getDb();
    const normalizedLimit = Math.min(Math.max(Math.trunc(input?.limit ?? 200), 1), 500);
    const query = input?.query?.trim();
    const planCode = input?.planCode?.trim().toLowerCase();
    const filters: SQL[] = [];

    if (query) {
      const likeTerm = `%${query}%`;
      filters.push(sql`(t.slug ILIKE ${likeTerm} OR t.name ILIKE ${likeTerm} OR t.id::text ILIKE ${likeTerm})`);
    }

    if (planCode === "none") {
      filters.push(sql`ts.plan_code IS NULL`);
    } else if (planCode) {
      filters.push(sql`ts.plan_code = ${planCode}`);
    }
    const whereClause = filters.length > 0 ? sql`WHERE ${sql.join(filters, sql` AND `)}` : sql``;

    const result = await db.execute(sql<SuperAdminTenantOverviewRow>`
      SELECT
        t.id AS "tenantId",
        t.slug AS "tenantSlug",
        t.name AS "tenantName",
        t.desired_whatsapp_bot_e164 AS "desiredWhatsappBotE164",
        t.operator_whatsapp_e164 AS "operatorWhatsappE164",
        ts.id AS "subscriptionId",
        ts.plan_code AS "planCode",
        ts.pending_plan_code AS "pendingPlanCode",
        ts.status,
        ts.effective_from AS "effectiveFrom",
        ts.effective_to AS "effectiveTo",
        ts.billing_cycle_anchor AS "billingCycleAnchor",
        ts.change_mode AS "changeMode"
      FROM tenants t
      LEFT JOIN LATERAL (
        SELECT *
        FROM tenant_subscriptions
        WHERE tenant_id = t.id
        ORDER BY updated_at DESC
        LIMIT 1
      ) ts ON TRUE
      ${whereClause}
      ORDER BY t.created_at DESC
      LIMIT ${normalizedLimit}
    `);

    return result.rows as unknown as SuperAdminTenantOverviewRow[];
  }

  async getLatestSubscription(tenantId: string): Promise<SuperAdminTenantSubscriptionRow | null> {
    const db = getDb();
    const result = await db.execute(sql<SuperAdminTenantSubscriptionRow>`
      SELECT
        id,
        tenant_id AS "tenantId",
        plan_code AS "planCode",
        pending_plan_code AS "pendingPlanCode",
        status,
        effective_from AS "effectiveFrom",
        effective_to AS "effectiveTo",
        billing_cycle_anchor AS "billingCycleAnchor",
        change_mode AS "changeMode"
      FROM tenant_subscriptions
      WHERE tenant_id = ${tenantId}
      ORDER BY updated_at DESC
      LIMIT 1
    `);

    return (result.rows[0] as SuperAdminTenantSubscriptionRow | undefined) ?? null;
  }

  async createInitialSubscription(input: {
    tenantId: string;
    planCode: string;
    effectiveFrom: Date;
  }): Promise<SuperAdminTenantSubscriptionRow> {
    const db = getDb();

    const result = await db.execute(sql<SuperAdminTenantSubscriptionRow>`
      INSERT INTO tenant_subscriptions (
        tenant_id,
        plan_code,
        effective_from,
        billing_cycle_anchor,
        status,
        change_mode,
        created_at,
        updated_at
      ) VALUES (
        ${input.tenantId},
        ${input.planCode},
        ${input.effectiveFrom},
        ${input.effectiveFrom},
        'active',
        'next_cycle',
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
        change_mode AS "changeMode"
    `);

    return result.rows[0] as unknown as SuperAdminTenantSubscriptionRow;
  }

  async scheduleNextCycle(input: {
    subscriptionId: string;
    pendingPlanCode: string;
  }): Promise<void> {
    const db = getDb();

    await db.execute(sql`
      UPDATE tenant_subscriptions
      SET
        pending_plan_code = ${input.pendingPlanCode},
        change_mode = 'next_cycle',
        updated_at = NOW()
      WHERE id = ${input.subscriptionId}
    `);
  }
}
