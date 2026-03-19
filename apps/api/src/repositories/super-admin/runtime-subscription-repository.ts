import { sql } from "drizzle-orm";
import { getDb } from "../../lib/db";

type ActiveSubscriptionRow = {
  planCode: string | null;
};

type PlanFeatureRow = {
  featureKey: string;
  valueJson: unknown;
};

export class RuntimeSubscriptionRepository {
  async getActivePlanCode(tenantId: string, now: Date): Promise<string | null> {
    const db = getDb();
    const result = await db.execute<ActiveSubscriptionRow>(sql`
      SELECT ts.plan_code AS "planCode"
      FROM tenant_subscriptions ts
      WHERE
        ts.tenant_id = ${tenantId}
        AND ts.status = 'active'
        AND ts.effective_from <= ${now}
        AND (ts.effective_to IS NULL OR ts.effective_to > ${now})
      ORDER BY ts.effective_from DESC, ts.updated_at DESC
      LIMIT 1
    `);

    return result.rows[0]?.planCode ?? null;
  }

  async getPlanFeatureMapByCode(planCode: string): Promise<Record<string, unknown>> {
    const db = getDb();
    const result = await db.execute<PlanFeatureRow>(sql`
      SELECT
        f.feature_key AS "featureKey",
        f.value_json AS "valueJson"
      FROM subscription_plan_features f
      INNER JOIN subscription_plans p ON p.id = f.plan_id
      WHERE p.code = ${planCode} AND p.is_active = TRUE
      ORDER BY f.feature_key ASC
    `);

    const featureMap: Record<string, unknown> = {};
    for (const row of result.rows) {
      featureMap[row.featureKey] = row.valueJson;
    }
    return featureMap;
  }
}
