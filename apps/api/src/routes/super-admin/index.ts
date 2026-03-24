import { Hono } from "hono";
import type { Context, Next } from "hono";
import { timingSafeEqual } from "node:crypto";
import { assertValidSlug, normalizeSlug } from "@genius/shared";
import { appError } from "../../lib/http";
import { getSuperAdminEnv } from "../../lib/super-admin/env";
import { signSuperAdminToken } from "../../lib/super-admin/token";
import { superAdminSessionAuthMiddleware } from "../../middleware/super-admin/session-auth";
import { TenantRepository } from "../../repositories";
import {
  SuperAdminPlanRepository,
  type SuperAdminPlanFeatureInput,
  type SuperAdminPlanSnapshotItem
} from "../../repositories/super-admin/plan-repository";
import { SuperAdminTenantSubscriptionRepository } from "../../repositories/super-admin/tenant-subscription-repository";
import { SuperAdminAuditRepository } from "../../repositories/super-admin/audit-repository";
import { SuperAdminVersionRepository } from "../../repositories/super-admin/version-repository";
import { SuperAdminRuntimeSettingsRepository } from "../../repositories/super-admin/runtime-settings-repository";
import { SuperAdminChannelEndpointRepository } from "../../repositories/super-admin/channel-endpoint-repository";
import { getApiEnv } from "../../lib/env";

const planRepository = new SuperAdminPlanRepository();
const tenantSubscriptionRepository = new SuperAdminTenantSubscriptionRepository();
const auditRepository = new SuperAdminAuditRepository();
const versionRepository = new SuperAdminVersionRepository();
const runtimeSettingsRepository = new SuperAdminRuntimeSettingsRepository();
const channelEndpointRepository = new SuperAdminChannelEndpointRepository();
const tenantRepository = new TenantRepository();
const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const CANONICAL_PLAN_CODES = new Set(["starter", "pro", "business", "enterprise"]);
const CHANNEL_ENVIRONMENTS = new Set(["sandbox", "production"]);
const CHANNEL_BINDING_STATUSES = new Set(["draft", "pending_verification", "connected", "disabled"]);
const CHANNEL_TOKEN_SOURCES = new Set(["unknown", "map", "fallback"]);
const CHANNEL_TEMPLATE_STATUSES = new Set(["unknown", "not_ready", "ready"]);
const CHANNEL_PROFILE_STATUSES = new Set(["unknown", "incomplete", "ready"]);

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

function assertCanonicalPlanCode(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!CANONICAL_PLAN_CODES.has(normalized)) {
    throw appError("VALIDATION_ERROR", { reason: "plan_code_not_allowed" });
  }
  return normalized;
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

function parseWhatsAppTokenMap(raw: string | undefined): Map<string, string> {
  const source = raw?.trim() ?? "";
  if (!source) {
    return new Map<string, string>();
  }
  try {
    const parsed = JSON.parse(source) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return new Map<string, string>();
    }
    return new Map<string, string>(
      Object.entries(parsed as Record<string, unknown>)
        .filter(
          ([phoneNumberId, token]) =>
            phoneNumberId.trim().length > 0 && typeof token === "string" && token.trim().length > 0
        )
        .map(([phoneNumberId, token]) => [phoneNumberId.trim(), (token as string).trim()])
    );
  } catch {
    return new Map<string, string>();
  }
}

function parseChannelEnum<T extends string>(value: unknown, allowed: Set<T>, reason: string): T {
  if (typeof value !== "string") {
    throw appError("VALIDATION_ERROR", { reason });
  }
  const normalized = value.trim().toLowerCase() as T;
  if (!allowed.has(normalized)) {
    throw appError("VALIDATION_ERROR", { reason });
  }
  return normalized;
}

function parseChannelEnvironment(value: unknown): "sandbox" | "production" {
  return parseChannelEnum(value, CHANNEL_ENVIRONMENTS as Set<"sandbox" | "production">, "channel_environment_invalid");
}

function parseChannelBindingStatus(value: unknown): "draft" | "pending_verification" | "connected" | "disabled" {
  return parseChannelEnum(
    value,
    CHANNEL_BINDING_STATUSES as Set<"draft" | "pending_verification" | "connected" | "disabled">,
    "channel_binding_status_invalid"
  );
}

function parseChannelTokenSource(value: unknown): "unknown" | "map" | "fallback" {
  return parseChannelEnum(value, CHANNEL_TOKEN_SOURCES as Set<"unknown" | "map" | "fallback">, "channel_token_source_invalid");
}

function parseChannelTemplateStatus(value: unknown): "unknown" | "not_ready" | "ready" {
  return parseChannelEnum(
    value,
    CHANNEL_TEMPLATE_STATUSES as Set<"unknown" | "not_ready" | "ready">,
    "channel_template_status_invalid"
  );
}

function parseChannelProfileStatus(value: unknown): "unknown" | "incomplete" | "ready" {
  return parseChannelEnum(
    value,
    CHANNEL_PROFILE_STATUSES as Set<"unknown" | "incomplete" | "ready">,
    "channel_profile_status_invalid"
  );
}

function normalizeOptionalString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function parseOptionalDate(value: unknown, reason: string): Date | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw appError("VALIDATION_ERROR", { reason });
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw appError("VALIDATION_ERROR", { reason });
  }
  return parsed;
}

async function fetchBotWhatsAppTokenHealth() {
  const botUrl = process.env.BOT_URL?.trim();
  if (!botUrl) {
    return new Map<string, { status: "ok" | "error"; httpStatus?: number | null }>();
  }

  try {
    const response = await fetch(new URL("/internal/health/wa-token", botUrl).toString(), {
      headers: {
        "x-internal-secret": getApiEnv().internalApiSecret
      }
    });
    if (!response.ok) {
      return new Map<string, { status: "ok" | "error"; httpStatus?: number | null }>();
    }

    const payload = (await response.json().catch(() => null)) as
      | {
          data?: {
            details?: Array<{ phoneNumberId?: string; status?: "ok" | "error"; httpStatus?: number | null }>;
          };
        }
      | null;

    return new Map(
      (payload?.data?.details ?? [])
        .filter((item) => typeof item.phoneNumberId === "string" && item.phoneNumberId.trim().length > 0)
        .map((item) => [
          item.phoneNumberId!.trim(),
          {
            status: item.status === "error" ? "error" : "ok",
            httpStatus: typeof item.httpStatus === "number" ? item.httpStatus : null
          }
        ])
    );
  } catch {
    return new Map<string, { status: "ok" | "error"; httpStatus?: number | null }>();
  }
}

function isUndefinedTableError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  return String((error as { code: unknown }).code) === "42P01";
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
    const items = (await planRepository.listPlans()).filter((item) => CANONICAL_PLAN_CODES.has(item.code));
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

    const code = assertCanonicalPlanCode(body.code);
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
    const currentSnapshot = (await planRepository.buildSnapshot()).filter((item) =>
      CANONICAL_PLAN_CODES.has(item.code)
    );

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
      ? (latest.snapshotJson as SuperAdminPlanSnapshotItem[]).filter((item) =>
          CANONICAL_PLAN_CODES.has(item.code)
        )
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

    const snapshot = (await planRepository.buildSnapshot()).filter((item) =>
      CANONICAL_PLAN_CODES.has(item.code)
    );
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

    await planRepository.applySnapshot(
      (snapshot as Parameters<typeof planRepository.applySnapshot>[0]).filter((item) =>
        CANONICAL_PLAN_CODES.has(item.code)
      )
    );

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
    const query = c.req.query("q")?.trim() ?? null;
    const planCode = c.req.query("planCode")?.trim().toLowerCase() ?? null;
    const items = await tenantSubscriptionRepository.listTenantsOverview({
      limit,
      query,
      planCode
    });
    return c.json({ data: { items } });
  })
  .put("/tenants/:tenantId/slug", async (c) => {
    const tenantId = c.req.param("tenantId");
    const body = await c.req.json<{ slug?: string; actor?: string }>();
    const slugInput = body.slug?.trim();
    if (!slugInput) {
      throw appError("VALIDATION_ERROR", { required: ["slug"] });
    }

    const tenant = await tenantRepository.findById(tenantId);
    if (!tenant) {
      throw appError("TENANT_NOT_FOUND", { reason: "tenant_not_found" });
    }

    const normalizedSlug = normalizeSlug(slugInput);
    try {
      assertValidSlug(normalizedSlug);
    } catch (error) {
      throw appError("VALIDATION_ERROR", {
        reason: error instanceof Error ? error.message : "slug_invalid"
      });
    }

    if (tenant.slug === normalizedSlug) {
      return c.json({
        data: {
          tenantId: tenant.id,
          slug: tenant.slug,
          changed: false
        }
      });
    }

    let updated;
    try {
      updated = await tenantRepository.updateSlug({ tenantId, slug: normalizedSlug });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error) {
        const code = String((error as { code: unknown }).code);
        if (code === "23505") {
          throw appError("CONFLICT", { reason: "slug_already_exists" });
        }
      }
      throw error;
    }

    if (!updated) {
      throw appError("TENANT_NOT_FOUND", { reason: "tenant_not_found" });
    }

    await auditRepository.createLog({
      actor: normalizeActor(body.actor),
      action: "super_admin.tenant.update_slug",
      entity: "tenant",
      entityId: tenantId,
      beforeJson: { slug: tenant.slug },
      afterJson: { slug: updated.slug },
      requestId: undefined
    });

    return c.json({
      data: {
        tenantId: updated.id,
        slug: updated.slug,
        changed: true
      }
    });
  })
  .put("/tenants/:tenantId/subscription", async (c) => {
    const tenantId = c.req.param("tenantId");
    const body = await c.req.json<{ planCode?: string; actor?: string }>();
    const planCode = body.planCode ? assertCanonicalPlanCode(body.planCode) : "";

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
  .get("/whatsapp/endpoints", async (c) => {
    const tokenMap = parseWhatsAppTokenMap(process.env.WA_ACCESS_TOKEN_BY_PHONE_JSON);
    const fallbackTokenConfigured = Boolean(process.env.WA_ACCESS_TOKEN?.trim());
    const healthByPhoneNumberId = await fetchBotWhatsAppTokenHealth();
    const items = await channelEndpointRepository.listWhatsAppEndpoints();

    const enrichedItems = items.map((item) => {
      const tokenSourceResolved = tokenMap.has(item.externalEndpointId)
        ? "map"
        : fallbackTokenConfigured
          ? "fallback"
          : "unknown";
      const tokenConfigured = tokenSourceResolved !== "unknown";
      const health = healthByPhoneNumberId.get(item.externalEndpointId);
      return {
        ...item,
        tokenConfigured,
        tokenSourceResolved,
        tokenHealthStatus: tokenConfigured ? health?.status ?? "unknown" : "missing",
        tokenHealthHttpStatus: health?.httpStatus ?? null
      };
    });

    return c.json({
      data: {
        items: enrichedItems,
        summary: {
          total: enrichedItems.length,
          connected: enrichedItems.filter((item) => item.bindingStatus === "connected" && item.isActive).length,
          sandbox: enrichedItems.filter((item) => item.environment === "sandbox").length,
          production: enrichedItems.filter((item) => item.environment === "production").length,
          tokenMissing: enrichedItems.filter((item) => !item.tokenConfigured).length
        }
      }
    });
  })
  .post("/whatsapp/endpoints", async (c) => {
    const body = await c.req.json<{
      tenantId?: string;
      accountId?: string;
      salonId?: string;
      externalEndpointId?: string;
      environment?: unknown;
      bindingStatus?: unknown;
      displayName?: unknown;
      displayPhoneNumber?: unknown;
      e164?: unknown;
      verifiedName?: unknown;
      wabaId?: unknown;
      businessId?: unknown;
      tokenSource?: unknown;
      templateStatus?: unknown;
      profileStatus?: unknown;
      qualityRating?: unknown;
      metaStatus?: unknown;
      codeVerificationStatus?: unknown;
      notes?: unknown;
      isActive?: unknown;
      connectedAt?: unknown;
      disconnectedAt?: unknown;
      lastInboundAt?: unknown;
      lastOutboundAt?: unknown;
      actor?: string;
    }>();

    const tenantId = body.tenantId?.trim();
    const externalEndpointId = body.externalEndpointId?.trim();
    if (!tenantId || !externalEndpointId) {
      throw appError("VALIDATION_ERROR", { required: ["tenantId", "externalEndpointId"] });
    }

    const tenant = await tenantRepository.findById(tenantId);
    if (!tenant) {
      throw appError("TENANT_NOT_FOUND", { reason: "tenant_not_found" });
    }

    const actor = normalizeActor(body.actor);
    let created;
    try {
      created = await channelEndpointRepository.upsertWhatsAppEndpoint({
        tenantId,
        accountId: body.accountId?.trim() || tenant.id,
        salonId: body.salonId?.trim() || tenant.id,
        externalEndpointId,
        environment: parseChannelEnvironment(body.environment ?? "production"),
        bindingStatus: parseChannelBindingStatus(body.bindingStatus ?? "draft"),
        displayName: normalizeOptionalString(body.displayName, 140),
        displayPhoneNumber: normalizeOptionalString(body.displayPhoneNumber, 32),
        e164: normalizeOptionalString(body.e164, 32),
        verifiedName: normalizeOptionalString(body.verifiedName, 140),
        wabaId: normalizeOptionalString(body.wabaId, 64),
        businessId: normalizeOptionalString(body.businessId, 64),
        tokenSource: parseChannelTokenSource(body.tokenSource ?? "unknown"),
        templateStatus: parseChannelTemplateStatus(body.templateStatus ?? "unknown"),
        profileStatus: parseChannelProfileStatus(body.profileStatus ?? "unknown"),
        qualityRating: normalizeOptionalString(body.qualityRating, 32),
        metaStatus: normalizeOptionalString(body.metaStatus, 32),
        codeVerificationStatus: normalizeOptionalString(body.codeVerificationStatus, 32),
        notes: normalizeOptionalString(body.notes, 2000),
        isActive: body.isActive !== false,
        connectedAt: parseOptionalDate(body.connectedAt, "channel_connected_at_invalid"),
        disconnectedAt: parseOptionalDate(body.disconnectedAt, "channel_disconnected_at_invalid"),
        lastInboundAt: parseOptionalDate(body.lastInboundAt, "channel_last_inbound_at_invalid"),
        lastOutboundAt: parseOptionalDate(body.lastOutboundAt, "channel_last_outbound_at_invalid"),
        actor
      });
    } catch (error) {
      if (isUndefinedTableError(error)) {
        throw appError("INTERNAL_ERROR", { reason: "whatsapp_registry_storage_not_ready_run_migrations" });
      }
      throw error;
    }

    if (!created) {
      throw appError("INTERNAL_ERROR", { reason: "channel_endpoint_create_failed" });
    }

    await auditRepository.createLog({
      actor,
      action: "super_admin.whatsapp_endpoint.create",
      entity: "channel_endpoints_v2",
      entityId: created.id,
      afterJson: created,
      requestId: undefined
    });

    return c.json({ data: created }, 201);
  })
  .put("/whatsapp/endpoints/:id", async (c) => {
    const endpointId = c.req.param("id");
    const before = await channelEndpointRepository.getEndpointById(endpointId);
    if (!before) {
      throw appError("TENANT_NOT_FOUND", { reason: "whatsapp_endpoint_not_found" });
    }

    const body = await c.req.json<{
      tenantId?: string;
      accountId?: string;
      salonId?: string;
      externalEndpointId?: string;
      environment?: unknown;
      bindingStatus?: unknown;
      displayName?: unknown;
      displayPhoneNumber?: unknown;
      e164?: unknown;
      verifiedName?: unknown;
      wabaId?: unknown;
      businessId?: unknown;
      tokenSource?: unknown;
      templateStatus?: unknown;
      profileStatus?: unknown;
      qualityRating?: unknown;
      metaStatus?: unknown;
      codeVerificationStatus?: unknown;
      notes?: unknown;
      isActive?: unknown;
      connectedAt?: unknown;
      disconnectedAt?: unknown;
      lastInboundAt?: unknown;
      lastOutboundAt?: unknown;
      actor?: string;
    }>();

    const tenantId = body.tenantId?.trim() || before.tenantId;
    const tenant = await tenantRepository.findById(tenantId);
    if (!tenant) {
      throw appError("TENANT_NOT_FOUND", { reason: "tenant_not_found" });
    }

    const actor = normalizeActor(body.actor);
    let updated;
    try {
      updated = await channelEndpointRepository.upsertWhatsAppEndpoint({
        id: endpointId,
        tenantId,
        accountId: body.accountId?.trim() || before.accountId,
        salonId: body.salonId?.trim() || before.salonId,
        externalEndpointId: body.externalEndpointId?.trim() || before.externalEndpointId,
        environment: parseChannelEnvironment(body.environment ?? before.environment),
        bindingStatus: parseChannelBindingStatus(body.bindingStatus ?? before.bindingStatus),
        displayName: normalizeOptionalString(body.displayName, 140) ?? before.displayName,
        displayPhoneNumber:
          normalizeOptionalString(body.displayPhoneNumber, 32) ?? before.displayPhoneNumber,
        e164: normalizeOptionalString(body.e164, 32) ?? before.e164,
        verifiedName: normalizeOptionalString(body.verifiedName, 140) ?? before.verifiedName,
        wabaId: normalizeOptionalString(body.wabaId, 64) ?? before.wabaId,
        businessId: normalizeOptionalString(body.businessId, 64) ?? before.businessId,
        tokenSource: parseChannelTokenSource(body.tokenSource ?? before.tokenSource),
        templateStatus: parseChannelTemplateStatus(body.templateStatus ?? before.templateStatus),
        profileStatus: parseChannelProfileStatus(body.profileStatus ?? before.profileStatus),
        qualityRating: normalizeOptionalString(body.qualityRating, 32) ?? before.qualityRating,
        metaStatus: normalizeOptionalString(body.metaStatus, 32) ?? before.metaStatus,
        codeVerificationStatus:
          normalizeOptionalString(body.codeVerificationStatus, 32) ?? before.codeVerificationStatus,
        notes: normalizeOptionalString(body.notes, 2000) ?? before.notes,
        isActive: typeof body.isActive === "boolean" ? body.isActive : before.isActive,
        connectedAt:
          body.connectedAt === ""
            ? null
            : parseOptionalDate(body.connectedAt, "channel_connected_at_invalid") ?? before.connectedAt,
        disconnectedAt:
          body.disconnectedAt === ""
            ? null
            : parseOptionalDate(body.disconnectedAt, "channel_disconnected_at_invalid") ?? before.disconnectedAt,
        lastInboundAt:
          body.lastInboundAt === ""
            ? null
            : parseOptionalDate(body.lastInboundAt, "channel_last_inbound_at_invalid") ?? before.lastInboundAt,
        lastOutboundAt:
          body.lastOutboundAt === ""
            ? null
            : parseOptionalDate(body.lastOutboundAt, "channel_last_outbound_at_invalid") ?? before.lastOutboundAt,
        actor
      });
    } catch (error) {
      if (isUndefinedTableError(error)) {
        throw appError("INTERNAL_ERROR", { reason: "whatsapp_registry_storage_not_ready_run_migrations" });
      }
      throw error;
    }

    if (!updated) {
      throw appError("INTERNAL_ERROR", { reason: "channel_endpoint_update_failed" });
    }

    await auditRepository.createLog({
      actor,
      action: "super_admin.whatsapp_endpoint.update",
      entity: "channel_endpoints_v2",
      entityId: updated.id,
      beforeJson: before,
      afterJson: updated,
      requestId: undefined
    });

    return c.json({ data: updated });
  })
  .get("/audit-log", async (c) => {
    const limitRaw = c.req.query("limit");
    const limit = limitRaw ? Number(limitRaw) : 200;
    const items = await auditRepository.listAuditLog(limit);
    return c.json({ data: { items } });
  })
  .get("/system-settings", async (c) => {
    const envDefault = getApiEnv().authEmailVerificationRequired;
    const runtime = await runtimeSettingsRepository.getAuthEmailVerificationRequired();
    const value = runtime.source === "runtime" && runtime.value !== null ? runtime.value : envDefault;
    return c.json({
      data: {
        authEmailVerificationRequired: value,
        source: runtime.source === "runtime" ? "runtime" : "env_default",
        envDefault,
        updatedBy: runtime.updatedBy,
        updatedAt: runtime.updatedAt
      }
    });
  })
  .patch("/system-settings", async (c) => {
    const body = await c.req.json<{
      authEmailVerificationRequired?: unknown;
      actor?: string;
    }>();

    if (typeof body.authEmailVerificationRequired !== "boolean") {
      throw appError("VALIDATION_ERROR", { reason: "auth_email_verification_required_boolean_expected" });
    }

    const beforeRuntime = await runtimeSettingsRepository.getAuthEmailVerificationRequired();
    const envDefault = getApiEnv().authEmailVerificationRequired;
    const beforeValue =
      beforeRuntime.source === "runtime" && beforeRuntime.value !== null
        ? beforeRuntime.value
        : envDefault;

    let updated;
    try {
      updated = await runtimeSettingsRepository.setAuthEmailVerificationRequired({
        value: body.authEmailVerificationRequired,
        actor: normalizeActor(body.actor)
      });
    } catch (error) {
      if (isUndefinedTableError(error)) {
        throw appError("INTERNAL_ERROR", {
          reason: "system_settings_storage_not_ready_run_migrations"
        });
      }
      throw error;
    }

    await auditRepository.createLog({
      actor: normalizeActor(body.actor),
      action: "super_admin.system_settings.update_email_verification_requirement",
      entity: "system_runtime_settings",
      entityId: "auth_email_verification_required",
      beforeJson: {
        authEmailVerificationRequired: beforeValue
      },
      afterJson: {
        authEmailVerificationRequired: updated.value,
        source: "runtime",
        updatedBy: updated.updatedBy,
        updatedAt: updated.updatedAt
      },
      requestId: undefined
    });

    return c.json({
      data: {
        authEmailVerificationRequired: updated.value,
        source: "runtime",
        envDefault,
        updatedBy: updated.updatedBy,
        updatedAt: updated.updatedAt
      }
    });
  });
