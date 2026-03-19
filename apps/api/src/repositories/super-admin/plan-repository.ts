import { sql } from "drizzle-orm";
import { getDb } from "../../lib/db";

export type SuperAdminPlanRow = {
  id: string;
  code: string;
  name: string;
  priceCents: number;
  currency: string;
  billingPeriod: "month" | "year";
  isActive: boolean;
  isRecommended: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

export type SuperAdminPlanFeatureRow = {
  id: string;
  planId: string;
  featureKey: string;
  featureType: "boolean" | "number" | "string" | "json";
  valueJson: unknown;
  createdAt: Date;
  updatedAt: Date;
};

export type SuperAdminPlanFeatureInput = {
  featureKey: string;
  featureType: "boolean" | "number" | "string" | "json";
  valueJson: unknown;
};

export type SuperAdminPlanInput = {
  code: string;
  name: string;
  priceCents: number;
  currency: string;
  billingPeriod: "month" | "year";
  isActive: boolean;
  isRecommended: boolean;
  sortOrder: number;
};

export type SuperAdminPlanSnapshotItem = SuperAdminPlanRow & {
  features: SuperAdminPlanFeatureRow[];
};

export class SuperAdminPlanRepository {
  async listPlans(): Promise<SuperAdminPlanRow[]> {
    const db = getDb();
    const result = await db.execute(sql<SuperAdminPlanRow>`
      SELECT
        id,
        code,
        name,
        price_cents AS "priceCents",
        currency,
        billing_period AS "billingPeriod",
        is_active AS "isActive",
        is_recommended AS "isRecommended",
        sort_order AS "sortOrder",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM subscription_plans
      ORDER BY sort_order ASC, code ASC
    `);

    return result.rows as unknown as SuperAdminPlanRow[];
  }

  async getPlanById(id: string): Promise<SuperAdminPlanRow | null> {
    const db = getDb();
    const result = await db.execute(sql<SuperAdminPlanRow>`
      SELECT
        id,
        code,
        name,
        price_cents AS "priceCents",
        currency,
        billing_period AS "billingPeriod",
        is_active AS "isActive",
        is_recommended AS "isRecommended",
        sort_order AS "sortOrder",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM subscription_plans
      WHERE id = ${id}
      LIMIT 1
    `);

    return (result.rows[0] as SuperAdminPlanRow | undefined) ?? null;
  }

  async getPlanByCode(code: string): Promise<SuperAdminPlanRow | null> {
    const db = getDb();
    const result = await db.execute(sql<SuperAdminPlanRow>`
      SELECT
        id,
        code,
        name,
        price_cents AS "priceCents",
        currency,
        billing_period AS "billingPeriod",
        is_active AS "isActive",
        is_recommended AS "isRecommended",
        sort_order AS "sortOrder",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM subscription_plans
      WHERE code = ${code}
      LIMIT 1
    `);

    return (result.rows[0] as SuperAdminPlanRow | undefined) ?? null;
  }

  async createPlan(input: SuperAdminPlanInput): Promise<SuperAdminPlanRow> {
    const db = getDb();
    const result = await db.execute(sql<SuperAdminPlanRow>`
      INSERT INTO subscription_plans (
        code,
        name,
        price_cents,
        currency,
        billing_period,
        is_active,
        is_recommended,
        sort_order
      ) VALUES (
        ${input.code},
        ${input.name},
        ${input.priceCents},
        ${input.currency},
        ${input.billingPeriod},
        ${input.isActive},
        ${input.isRecommended},
        ${input.sortOrder}
      )
      RETURNING
        id,
        code,
        name,
        price_cents AS "priceCents",
        currency,
        billing_period AS "billingPeriod",
        is_active AS "isActive",
        is_recommended AS "isRecommended",
        sort_order AS "sortOrder",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `);

    return result.rows[0] as unknown as SuperAdminPlanRow;
  }

  async updatePlan(
    id: string,
    input: Partial<Omit<SuperAdminPlanInput, "code">>
  ): Promise<SuperAdminPlanRow | null> {
    const current = await this.getPlanById(id);
    if (!current) {
      return null;
    }

    const next = {
      name: input.name ?? current.name,
      priceCents: input.priceCents ?? current.priceCents,
      currency: input.currency ?? current.currency,
      billingPeriod: input.billingPeriod ?? current.billingPeriod,
      isActive: input.isActive ?? current.isActive,
      isRecommended: input.isRecommended ?? current.isRecommended,
      sortOrder: input.sortOrder ?? current.sortOrder
    };

    const db = getDb();
    const result = await db.execute(sql<SuperAdminPlanRow>`
      UPDATE subscription_plans
      SET
        name = ${next.name},
        price_cents = ${next.priceCents},
        currency = ${next.currency},
        billing_period = ${next.billingPeriod},
        is_active = ${next.isActive},
        is_recommended = ${next.isRecommended},
        sort_order = ${next.sortOrder},
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING
        id,
        code,
        name,
        price_cents AS "priceCents",
        currency,
        billing_period AS "billingPeriod",
        is_active AS "isActive",
        is_recommended AS "isRecommended",
        sort_order AS "sortOrder",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `);

    return (result.rows[0] as SuperAdminPlanRow | undefined) ?? null;
  }

  async listPlanFeatures(planId: string): Promise<SuperAdminPlanFeatureRow[]> {
    const db = getDb();
    const result = await db.execute(sql<SuperAdminPlanFeatureRow>`
      SELECT
        id,
        plan_id AS "planId",
        feature_key AS "featureKey",
        feature_type AS "featureType",
        value_json AS "valueJson",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM subscription_plan_features
      WHERE plan_id = ${planId}
      ORDER BY feature_key ASC
    `);

    return result.rows as unknown as SuperAdminPlanFeatureRow[];
  }

  async replacePlanFeatures(
    planId: string,
    features: SuperAdminPlanFeatureInput[]
  ): Promise<SuperAdminPlanFeatureRow[]> {
    const db = getDb();

    await db.transaction(async (tx) => {
      await tx.execute(sql`
        DELETE FROM subscription_plan_features
        WHERE plan_id = ${planId}
      `);

      for (const feature of features) {
        await tx.execute(sql`
          INSERT INTO subscription_plan_features (
            plan_id,
            feature_key,
            feature_type,
            value_json,
            created_at,
            updated_at
          ) VALUES (
            ${planId},
            ${feature.featureKey},
            ${feature.featureType},
            ${JSON.stringify(feature.valueJson ?? null)}::jsonb,
            NOW(),
            NOW()
          )
        `);
      }
    });

    return this.listPlanFeatures(planId);
  }

  async buildSnapshot(): Promise<SuperAdminPlanSnapshotItem[]> {
    const plans = await this.listPlans();
    const items: SuperAdminPlanSnapshotItem[] = [];

    for (const plan of plans) {
      const features = await this.listPlanFeatures(plan.id);
      items.push({ ...plan, features });
    }

    return items;
  }

  async applySnapshot(snapshot: SuperAdminPlanSnapshotItem[]): Promise<void> {
    const db = getDb();

    await db.transaction(async (tx) => {
      const codes = snapshot.map((item) => item.code);
      if (codes.length > 0) {
        await tx.execute(sql`
          UPDATE subscription_plans
          SET is_active = FALSE, updated_at = NOW()
          WHERE code NOT IN (${sql.join(codes.map((item) => sql`${item}`), sql`, `)})
        `);
      }

      for (const item of snapshot) {
        await tx.execute(sql`
          INSERT INTO subscription_plans (
            code,
            name,
            price_cents,
            currency,
            billing_period,
            is_active,
            is_recommended,
            sort_order,
            created_at,
            updated_at
          ) VALUES (
            ${item.code},
            ${item.name},
            ${item.priceCents},
            ${item.currency},
            ${item.billingPeriod},
            ${item.isActive},
            ${item.isRecommended},
            ${item.sortOrder},
            NOW(),
            NOW()
          )
          ON CONFLICT (code)
          DO UPDATE SET
            name = EXCLUDED.name,
            price_cents = EXCLUDED.price_cents,
            currency = EXCLUDED.currency,
            billing_period = EXCLUDED.billing_period,
            is_active = EXCLUDED.is_active,
            is_recommended = EXCLUDED.is_recommended,
            sort_order = EXCLUDED.sort_order,
            updated_at = NOW()
        `);

        const planIdResult = await tx.execute<{ id: string }>(sql`
          SELECT id FROM subscription_plans WHERE code = ${item.code} LIMIT 1
        `);
        const planId = planIdResult.rows[0]?.id;
        if (!planId) {
          continue;
        }

        await tx.execute(sql`
          DELETE FROM subscription_plan_features
          WHERE plan_id = ${planId}
        `);

        for (const feature of item.features) {
          await tx.execute(sql`
            INSERT INTO subscription_plan_features (
              plan_id,
              feature_key,
              feature_type,
              value_json,
              created_at,
              updated_at
            ) VALUES (
              ${planId},
              ${feature.featureKey},
              ${feature.featureType},
              ${JSON.stringify(feature.valueJson ?? null)}::jsonb,
              NOW(),
              NOW()
            )
          `);
        }
      }
    });
  }
}
