import { Hono } from "hono";
import type { Context, Next } from "hono";
import { timingSafeEqual } from "node:crypto";
import { appError } from "../../lib/http";
import { getSuperAdminEnv } from "../../lib/super-admin/env";
import { signSuperAdminToken } from "../../lib/super-admin/token";
import { superAdminSessionAuthMiddleware } from "../../middleware/super-admin/session-auth";
import {
  SuperAdminPlanRepository,
  type SuperAdminPlanFeatureInput,
  type SuperAdminPlanSnapshotItem
} from "../../repositories/super-admin/plan-repository";
import { SuperAdminTenantSubscriptionRepository } from "../../repositories/super-admin/tenant-subscription-repository";
import { SuperAdminAuditRepository } from "../../repositories/super-admin/audit-repository";
import { SuperAdminVersionRepository } from "../../repositories/super-admin/version-repository";

const planRepository = new SuperAdminPlanRepository();
const tenantSubscriptionRepository = new SuperAdminTenantSubscriptionRepository();
const auditRepository = new SuperAdminAuditRepository();
const versionRepository = new SuperAdminVersionRepository();
const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const IS_PRODUCTION = process.env.NODE_ENV === "production";

function buildSuperAdminCookie(input: {
  cookieName: string;
  token: string;
  maxAgeSeconds: number;
}) {
  const sameSite = IS_PRODUCTION ? "None" : "Strict";
  const secure = IS_PRODUCTION ? "; Secure" : "";
  return `${input.cookieName}=${input.token}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${input.maxAgeSeconds}${secure}`;
}

function secureCompare(left: string, right: string): boolean {
  const leftBuf = Buffer.from(left, "utf8");
  const rightBuf = Buffer.from(right, "utf8");

  if (leftBuf.length !== rightBuf.length) {
    return false;
  }

  return timingSafeEqual(leftBuf, rightBuf);
}

function normalizeActor(value: string | undefined): string {
  const actor = value?.trim();
  return actor && actor.length > 0 ? actor.slice(0, 120) : "super_admin";
}

function parseBillingPeriod(value: unknown): "month" | "year" {
  if (value === "month" || value === "year") {
    return value;
  }
  throw appError("VALIDATION_ERROR", { reason: "billing_period_invalid" });
}

function parseFeatureType(value: unknown): "boolean" | "number" | "string" | "json" {
  if (value === "boolean" || value === "number" || value === "string" || value === "json") {
    return value;
  }
  throw appError("VALIDATION_ERROR", { reason: "feature_type_invalid" });
}

function computeNextCycleDate(input: {
  now: Date;
  anchor: Date;
  billingPeriod: "month" | "year";
}): Date {
  const next = new Date(input.anchor);

  while (next <= input.now) {
    if (input.billingPeriod === "year") {
      next.setUTCFullYear(next.getUTCFullYear() + 1);
    } else {
      next.setUTCMonth(next.getUTCMonth() + 1);
    }
  }

  return next;
}

type SnapshotDiffItem = {
  code: string;
  changeType: "added" | "removed" | "updated";
  before?: {
    name: string;
    priceCents: number;
    currency: string;
    billingPeriod: "month" | "year";
    isActive: boolean;
    isRecommended: boolean;
    sortOrder: number;
    features: Record<string, { featureType: string; valueJson: unknown }>;
  };
  after?: {
    name: string;
    priceCents: number;
    currency: string;
    billingPeriod: "month" | "year";
    isActive: boolean;
    isRecommended: boolean;
    sortOrder: number;
    features: Record<string, { featureType: string; valueJson: unknown }>;
  };
};

function toFeatureMap(
  features: SuperAdminPlanSnapshotItem["features"]
): Record<string, { featureType: string; valueJson: unknown }> {
  const map: Record<string, { featureType: string; valueJson: unknown }> = {};
  for (const feature of features) {
    map[feature.featureKey] = {
      featureType: feature.featureType,
      valueJson: feature.valueJson
    };
  }
  return map;
}

function normalizeSnapshotItem(item: SuperAdminPlanSnapshotItem) {
  return {
    name: item.name,
    priceCents: item.priceCents,
    currency: item.currency,
    billingPeriod: item.billingPeriod,
    isActive: item.isActive,
    isRecommended: item.isRecommended,
    sortOrder: item.sortOrder,
    features: toFeatureMap(item.features)
  };
}

function snapshotDiff(
  publishedSnapshot: SuperAdminPlanSnapshotItem[],
  currentSnapshot: SuperAdminPlanSnapshotItem[]
): SnapshotDiffItem[] {
  const beforeByCode = new Map(publishedSnapshot.map((item) => [item.code, item]));
  const afterByCode = new Map(currentSnapshot.map((item) => [item.code, item]));
  const codes = new Set<string>([...beforeByCode.keys(), ...afterByCode.keys()]);
  const items: SnapshotDiffItem[] = [];

  for (const code of Array.from(codes).sort((a, b) => a.localeCompare(b))) {
    const before = beforeByCode.get(code);
    const after = afterByCode.get(code);

    if (!before && after) {
      items.push({
        code,
        changeType: "added",
        after: normalizeSnapshotItem(after)
      });
      continue;
    }

    if (before && !after) {
      items.push({
        code,
        changeType: "removed",
        before: normalizeSnapshotItem(before)
      });
      continue;
    }

    if (!before || !after) {
      continue;
    }

    const normalizedBefore = normalizeSnapshotItem(before);
    const normalizedAfter = normalizeSnapshotItem(after);
    if (JSON.stringify(normalizedBefore) !== JSON.stringify(normalizedAfter)) {
      items.push({
        code,
        changeType: "updated",
        before: normalizedBefore,
        after: normalizedAfter
      });
    }
  }

  return items;
}

async function superAdminCsrfMiddleware(c: Context, next: Next) {
  if (!STATE_CHANGING_METHODS.has(c.req.method)) {
    await next();
    return;
  }

  const csrfToken = c.req.header("x-csrf-token");
  if (!csrfToken) {
    throw appError("AUTH_FORBIDDEN", { reason: "missing csrf token" });
  }

  await next();
}

export const superAdminRoutes = new Hono()
  .post("/auth/login", async (c) => {
    const env = getSuperAdminEnv();
    const body: { secret?: string } = await c.req
      .json<{ secret?: string }>()
      .catch(() => ({}));
    const csrfToken = c.req.header("x-csrf-token");
    if (!csrfToken) {
      throw appError("AUTH_FORBIDDEN", { reason: "missing csrf token" });
    }

    const secret = body.secret?.trim();
    if (!secret) {
      throw appError("VALIDATION_ERROR", { reason: "super_admin_secret_required" });
    }

    if (!secureCompare(secret, env.loginSecret)) {
      throw appError("AUTH_UNAUTHORIZED", { reason: "super_admin_secret_invalid" });
    }

    const maxAgeSeconds = env.sessionTtlHours * 3600;
    const token = signSuperAdminToken({
      secret: env.sessionSecret,
      ttlSeconds: maxAgeSeconds
    });

    c.header("set-cookie", buildSuperAdminCookie({ cookieName: env.cookieName, token, maxAgeSeconds }));

    return c.json({ data: { ok: true } });
  })
  .use("/*", superAdminSessionAuthMiddleware)
  .use("/*", superAdminCsrfMiddleware)
  .post("/auth/logout", async (c) => {
    const env = getSuperAdminEnv();

    c.header("set-cookie", buildSuperAdminCookie({ cookieName: env.cookieName, token: "", maxAgeSeconds: 0 }));

    return c.json({ data: { ok: true } });
  })
  .get("/plans", async (c) => {
    const items = await planRepository.listPlans();
    return c.json({ data: { items } });
  })
  .post("/plans", async (c) => {
    const body = await c.req.json<{
      code?: string;
      name?: string;
      priceCents?: number;
      currency?: string;
      billingPeriod?: string;
      isActive?: boolean;
      isRecommended?: boolean;
      sortOrder?: number;
      actor?: string;
    }>();

    if (!body.code || !body.name || body.priceCents === undefined) {
      throw appError("VALIDATION_ERROR", { required: ["code", "name", "priceCents"] });
    }

    const code = body.code.trim().toLowerCase();
    const name = body.name.trim();
    const currency = (body.currency ?? "EUR").trim().toUpperCase();
    const sortOrder = Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0;
    const priceCents = Number(body.priceCents);

    if (!code || !name || !Number.isInteger(priceCents) || priceCents < 0) {
      throw appError("VALIDATION_ERROR", { reason: "plan_payload_invalid" });
    }

    let created;
    try {
      created = await planRepository.createPlan({
        code,
        name,
        priceCents,
        currency,
        billingPeriod: parseBillingPeriod(body.billingPeriod ?? "month"),
        isActive: body.isActive !== false,
        isRecommended: body.isRecommended === true,
        sortOrder
      });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error) {
        const codeValue = String((error as { code: unknown }).code);
        if (codeValue === "23505") {
          throw appError("CONFLICT", { reason: "plan_code_already_exists" });
        }
      }
      throw error;
    }

    await auditRepository.createLog({
      actor: normalizeActor(body.actor),
      action: "super_admin.plan.create",
      entity: "subscription_plan",
      entityId: created.id,
      afterJson: created,
      requestId: undefined
    });

    return c.json({ data: created }, 201);
  })
  .put("/plans/:id", async (c) => {
    const planId = c.req.param("id");
    const body = await c.req.json<{
      name?: string;
      priceCents?: number;
      currency?: string;
      billingPeriod?: string;
      isActive?: boolean;
      isRecommended?: boolean;
      sortOrder?: number;
      actor?: string;
    }>();

    const before = await planRepository.getPlanById(planId);
    if (!before) {
      throw appError("TENANT_NOT_FOUND", { reason: "plan_not_found" });
    }

    const updated = await planRepository.updatePlan(planId, {
      name: body.name?.trim(),
      priceCents: body.priceCents !== undefined ? Number(body.priceCents) : undefined,
      currency: body.currency?.trim().toUpperCase(),
      billingPeriod:
        body.billingPeriod !== undefined ? parseBillingPeriod(body.billingPeriod) : undefined,
      isActive: body.isActive,
      isRecommended: body.isRecommended,
      sortOrder:
        body.sortOrder !== undefined && Number.isFinite(Number(body.sortOrder))
          ? Number(body.sortOrder)
          : undefined
    });

    if (!updated) {
      throw appError("INTERNAL_ERROR", { reason: "plan_update_failed" });
    }

    await auditRepository.createLog({
      actor: normalizeActor(body.actor),
      action: "super_admin.plan.update",
      entity: "subscription_plan",
      entityId: planId,
      beforeJson: before,
      afterJson: updated,
      requestId: undefined
    });

    return c.json({ data: updated });
  })
  .get("/plans/:id/features", async (c) => {
    const planId = c.req.param("id");
    const items = await planRepository.listPlanFeatures(planId);
    return c.json({ data: { items } });
  })
  .put("/plans/:id/features", async (c) => {
    const planId = c.req.param("id");
    const body = await c.req.json<{
      items?: Array<{ featureKey?: string; featureType?: string; valueJson?: unknown }>;
      actor?: string;
    }>();

    if (!Array.isArray(body.items)) {
      throw appError("VALIDATION_ERROR", { required: ["items"] });
    }

    const before = await planRepository.listPlanFeatures(planId);
    const normalized: SuperAdminPlanFeatureInput[] = body.items.map((item) => {
      const featureKey = item.featureKey?.trim();
      if (!featureKey) {
        throw appError("VALIDATION_ERROR", { reason: "feature_key_required" });
      }

      return {
        featureKey,
        featureType: parseFeatureType(item.featureType),
        valueJson: item.valueJson ?? null
      };
    });

    const updated = await planRepository.replacePlanFeatures(planId, normalized);

    await auditRepository.createLog({
      actor: normalizeActor(body.actor),
      action: "super_admin.plan.features.replace",
      entity: "subscription_plan",
      entityId: planId,
      beforeJson: before,
      afterJson: updated,
      requestId: undefined
    });

    return c.json({ data: { items: updated } });
  })
  .get("/plan-versions", async (c) => {
    const limitRaw = c.req.query("limit");
    const limit = limitRaw ? Number(limitRaw) : 50;
    const items = await versionRepository.listVersions(limit);
    return c.json({ data: { items } });
  })
  .get("/plans/diff", async (c) => {
    const latest = await versionRepository.getLatestPublished();
    const currentSnapshot = await planRepository.buildSnapshot();

    if (!latest) {
      return c.json({
        data: {
          hasPublishedBaseline: false,
          baselineVersion: null,
          items: currentSnapshot.map((item) => ({
            code: item.code,
            changeType: "added" as const,
            after: normalizeSnapshotItem(item)
          }))
        }
      });
    }

    const baselineSnapshot = Array.isArray(latest.snapshotJson)
      ? (latest.snapshotJson as SuperAdminPlanSnapshotItem[])
      : [];
    return c.json({
      data: {
        hasPublishedBaseline: true,
        baselineVersion: latest.version,
        items: snapshotDiff(baselineSnapshot, currentSnapshot)
      }
    });
  })
  .post("/plans/publish", async (c) => {
    const body = await c.req
      .json<{ actor?: string }>()
      .catch((): { actor?: string } => ({}));

    const snapshot = await planRepository.buildSnapshot();
    const createdVersion = await versionRepository.createPublishedVersion({
      snapshotJson: snapshot,
      publishedBy: normalizeActor(body.actor)
    });

    await auditRepository.createLog({
      actor: normalizeActor(body.actor),
      action: "super_admin.plan.publish",
      entity: "subscription_plan_version",
      entityId: String(createdVersion.version),
      afterJson: createdVersion,
      requestId: undefined
    });

    return c.json({ data: createdVersion }, 201);
  })
  .post("/plans/rollback/:version", async (c) => {
    const version = Number(c.req.param("version"));
    if (!Number.isInteger(version) || version < 1) {
      throw appError("VALIDATION_ERROR", { reason: "version_invalid" });
    }

    const body = await c.req
      .json<{ actor?: string }>()
      .catch((): { actor?: string } => ({}));

    const target = await versionRepository.getByVersion(version);
    if (!target) {
      throw appError("TENANT_NOT_FOUND", { reason: "plan_version_not_found" });
    }

    const snapshot = target.snapshotJson;
    if (!Array.isArray(snapshot)) {
      throw appError("INTERNAL_ERROR", { reason: "plan_snapshot_invalid" });
    }

    await planRepository.applySnapshot(snapshot as Parameters<typeof planRepository.applySnapshot>[0]);

    const createdVersion = await versionRepository.createPublishedVersion({
      snapshotJson: snapshot,
      publishedBy: normalizeActor(body.actor)
    });

    await auditRepository.createLog({
      actor: normalizeActor(body.actor),
      action: "super_admin.plan.rollback",
      entity: "subscription_plan_version",
      entityId: String(version),
      beforeJson: target,
      afterJson: createdVersion,
      requestId: undefined
    });

    return c.json({ data: createdVersion });
  })
  .get("/tenants", async (c) => {
    const limitRaw = c.req.query("limit");
    const limit = limitRaw ? Number(limitRaw) : 200;
    const items = await tenantSubscriptionRepository.listTenantsOverview(limit);
    return c.json({ data: { items } });
  })
  .put("/tenants/:tenantId/subscription", async (c) => {
    const tenantId = c.req.param("tenantId");
    const body = await c.req.json<{ planCode?: string; actor?: string }>();
    const planCode = body.planCode?.trim().toLowerCase();

    if (!planCode) {
      throw appError("VALIDATION_ERROR", { required: ["planCode"] });
    }

    const tenantExists = await tenantSubscriptionRepository.tenantExists(tenantId);
    if (!tenantExists) {
      throw appError("TENANT_NOT_FOUND", { reason: "tenant_not_found" });
    }

    const targetPlan = await planRepository.getPlanByCode(planCode);
    if (!targetPlan) {
      throw appError("TENANT_NOT_FOUND", { reason: "plan_code_not_found" });
    }

    const now = new Date();
    const latest = await tenantSubscriptionRepository.getLatestSubscription(tenantId);

    if (!latest) {
      const created = await tenantSubscriptionRepository.createInitialSubscription({
        tenantId,
        planCode,
        effectiveFrom: now
      });

      await auditRepository.createLog({
        actor: normalizeActor(body.actor),
        action: "super_admin.tenant_subscription.create_initial",
        entity: "tenant_subscription",
        entityId: created.id,
        afterJson: created,
        requestId: undefined
      });

      return c.json({
        data: {
          mode: "activated_immediately",
          subscription: created,
          applyAt: now
        }
      });
    }

    const currentPlan = await planRepository.getPlanByCode(latest.planCode);
    if (!currentPlan) {
      throw appError("INTERNAL_ERROR", { reason: "current_plan_not_found" });
    }

    const anchor = latest.billingCycleAnchor ?? latest.effectiveFrom;
    const applyAt = computeNextCycleDate({
      now,
      anchor,
      billingPeriod: currentPlan.billingPeriod
    });

    await tenantSubscriptionRepository.scheduleNextCycle({
      subscriptionId: latest.id,
      pendingPlanCode: planCode
    });

    const after = await tenantSubscriptionRepository.getLatestSubscription(tenantId);

    await auditRepository.createLog({
      actor: normalizeActor(body.actor),
      action: "super_admin.tenant_subscription.schedule_next_cycle",
      entity: "tenant_subscription",
      entityId: latest.id,
      beforeJson: latest,
      afterJson: after,
      requestId: undefined
    });

    return c.json({
      data: {
        mode: "scheduled_next_cycle",
        applyAt,
        subscription: after
      }
    });
  })
  .get("/audit-log", async (c) => {
    const limitRaw = c.req.query("limit");
    const limit = limitRaw ? Number(limitRaw) : 200;
    const items = await auditRepository.listAuditLog(limit);
    return c.json({ data: { items } });
  });
