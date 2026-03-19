"use client";

import { useEffect, useMemo, useState } from "react";

type Plan = {
  id: string;
  code: string;
  name: string;
  priceCents: number;
  currency: string;
  billingPeriod: "month" | "year";
  isActive: boolean;
  isRecommended: boolean;
  sortOrder: number;
};

type PlanVersion = {
  version: number;
  status: string;
  publishedAt: string | null;
  publishedBy: string | null;
};

type TenantOverview = {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  planCode: string | null;
  pendingPlanCode: string | null;
};

type PlanFeature = {
  id: string;
  planId: string;
  featureKey: string;
  featureType: "boolean" | "number" | "string" | "json";
  valueJson: unknown;
};

type AuditLogRow = {
  id: string;
  actor: string;
  action: string;
  entity: string;
  entityId: string;
  createdAt: string;
};

type PlanDiffItem = {
  code: string;
  changeType: "added" | "removed" | "updated";
};

type ApiResponse<T> = {
  data?: T;
  error?: { code: string; message: string; details?: unknown };
};

async function requestJson<T>(
  url: string,
  init?: RequestInit
): Promise<{ ok: boolean; payload: ApiResponse<T> }> {
  const response = await fetch(url, {
    ...init,
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      "x-csrf-token": "super-admin",
      ...(init?.headers ?? {})
    }
  });
  const payload = (await response.json().catch(() => ({}))) as ApiResponse<T>;
  return { ok: response.ok, payload };
}

export default function SuperAdminPage() {
  const [secret, setSecret] = useState("");
  const [actor, setActor] = useState("super_admin");
  const [status, setStatus] = useState("");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [versions, setVersions] = useState<PlanVersion[]>([]);
  const [tenants, setTenants] = useState<TenantOverview[]>([]);
  const [priceDraft, setPriceDraft] = useState<Record<string, string>>({});
  const [assignTenantId, setAssignTenantId] = useState("");
  const [assignPlanCode, setAssignPlanCode] = useState("starter");
  const [rollbackVersion, setRollbackVersion] = useState("");
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [featureJsonDraft, setFeatureJsonDraft] = useState("");
  const [auditRows, setAuditRows] = useState<AuditLogRow[]>([]);
  const [planDiffItems, setPlanDiffItems] = useState<PlanDiffItem[]>([]);
  const [baselineVersion, setBaselineVersion] = useState<number | null>(null);
  const [publishConfirmed, setPublishConfirmed] = useState(false);

  async function loadAll() {
    const [plansResult, versionsResult, tenantsResult, auditResult, diffResult] = await Promise.all([
      requestJson<{ items: Plan[] }>("/api/super-admin/plans"),
      requestJson<{ items: PlanVersion[] }>("/api/super-admin/plan-versions"),
      requestJson<{ items: TenantOverview[] }>("/api/super-admin/tenants"),
      requestJson<{ items: AuditLogRow[] }>("/api/super-admin/audit-log?limit=100"),
      requestJson<{ baselineVersion: number | null; items: PlanDiffItem[] }>("/api/super-admin/plans/diff")
    ]);

    if (!plansResult.ok) {
      setStatus(plansResult.payload.error?.message ?? "Failed to load plans");
      return;
    }

    setPlans(plansResult.payload.data?.items ?? []);
    setVersions(versionsResult.payload.data?.items ?? []);
    setTenants(tenantsResult.payload.data?.items ?? []);
    setAuditRows(auditResult.payload.data?.items ?? []);
    setPlanDiffItems(diffResult.payload.data?.items ?? []);
    setBaselineVersion(diffResult.payload.data?.baselineVersion ?? null);
    setPublishConfirmed(false);
    setStatus("Data loaded");
  }

  useEffect(() => {
    void loadAll();
  }, []);

  const sortedPlans = useMemo(
    () => [...plans].sort((a, b) => a.sortOrder - b.sortOrder),
    [plans]
  );
  const selectedPlan = useMemo(
    () => sortedPlans.find((plan) => plan.id === selectedPlanId) ?? null,
    [sortedPlans, selectedPlanId]
  );

  async function login() {
    const result = await requestJson<{ ok: boolean }>("/api/super-admin/auth/login", {
      method: "POST",
      body: JSON.stringify({ secret })
    });

    if (!result.ok) {
      setStatus(result.payload.error?.message ?? "Super admin login failed");
      return;
    }

    setStatus("Super admin session created");
    await loadAll();
  }

  async function logout() {
    const result = await requestJson<{ ok: boolean }>("/api/super-admin/auth/logout", {
      method: "POST",
      body: JSON.stringify({})
    });

    if (!result.ok) {
      setStatus(result.payload.error?.message ?? "Logout failed");
      return;
    }

    setStatus("Session closed");
  }

  async function savePlanPrice(plan: Plan) {
    const draft = priceDraft[plan.id];
    const nextPrice = Number(draft ?? plan.priceCents / 100);
    if (!Number.isFinite(nextPrice) || nextPrice < 0) {
      setStatus("Invalid price");
      return;
    }

    const result = await requestJson<Plan>(`/api/super-admin/plans/${plan.id}`, {
      method: "PUT",
      body: JSON.stringify({
        priceCents: Math.round(nextPrice * 100),
        actor
      })
    });

    if (!result.ok) {
      setStatus(result.payload.error?.message ?? "Plan update failed");
      return;
    }

    setStatus(`Plan ${plan.code} updated`);
    await loadAll();
  }

  async function publishPlans() {
    if (!publishConfirmed) {
      setStatus("Confirm publish first");
      return;
    }

    const result = await requestJson<{ version: number }>("/api/super-admin/plans/publish", {
      method: "POST",
      body: JSON.stringify({ actor })
    });

    if (!result.ok) {
      setStatus(result.payload.error?.message ?? "Publish failed");
      return;
    }

    setStatus(`Published version ${result.payload.data?.version ?? "?"}`);
    await loadAll();
  }

  async function rollbackPlans() {
    const version = Number(rollbackVersion);
    if (!Number.isInteger(version) || version < 1) {
      setStatus("Rollback version is invalid");
      return;
    }

    const result = await requestJson<{ version: number }>(`/api/super-admin/plans/rollback/${version}`, {
      method: "POST",
      body: JSON.stringify({ actor })
    });

    if (!result.ok) {
      setStatus(result.payload.error?.message ?? "Rollback failed");
      return;
    }

    setStatus(`Rollback done. New published version ${result.payload.data?.version ?? "?"}`);
    await loadAll();
  }

  async function assignPlanToTenant() {
    if (!assignTenantId.trim()) {
      setStatus("Tenant ID required");
      return;
    }

    const result = await requestJson<{ mode: string; applyAt?: string }>(
      `/api/super-admin/tenants/${assignTenantId.trim()}/subscription`,
      {
        method: "PUT",
        body: JSON.stringify({ planCode: assignPlanCode, actor })
      }
    );

    if (!result.ok) {
      setStatus(result.payload.error?.message ?? "Tenant subscription update failed");
      return;
    }

    setStatus(`Tenant subscription updated (${result.payload.data?.mode ?? "ok"})`);
    await loadAll();
  }

  async function loadPlanFeatures(planId: string) {
    const result = await requestJson<{ items: PlanFeature[] }>(
      `/api/super-admin/plans/${planId}/features`
    );
    if (!result.ok) {
      setStatus(result.payload.error?.message ?? "Failed to load features");
      return;
    }

    const items = result.payload.data?.items ?? [];
    setFeatureJsonDraft(
      JSON.stringify(
        items.map((item) => ({
          featureKey: item.featureKey,
          featureType: item.featureType,
          valueJson: item.valueJson
        })),
        null,
        2
      )
    );
    setStatus("Plan features loaded");
  }

  async function savePlanFeatures() {
    if (!selectedPlan) {
      setStatus("Select plan first");
      return;
    }

    let parsed: Array<{ featureKey: string; featureType: string; valueJson?: unknown }>;
    try {
      const candidate = JSON.parse(featureJsonDraft) as unknown;
      if (!Array.isArray(candidate)) {
        throw new Error("invalid_json");
      }
      parsed = candidate as Array<{ featureKey: string; featureType: string; valueJson?: unknown }>;
    } catch {
      setStatus("Features JSON invalid");
      return;
    }

    const result = await requestJson<{ items: PlanFeature[] }>(
      `/api/super-admin/plans/${selectedPlan.id}/features`,
      {
        method: "PUT",
        body: JSON.stringify({ items: parsed, actor })
      }
    );

    if (!result.ok) {
      setStatus(result.payload.error?.message ?? "Failed to save plan features");
      return;
    }

    setStatus(`Features for ${selectedPlan.code} updated`);
    await loadAll();
  }

  return (
    <main className="gc-admin-page">
      <h1 className="gc-admin-title">Super Admin</h1>
      <p className="gc-admin-subtitle">Subscriptions, plan versions, and tenant mapping</p>
      <p className="gc-muted-line">{status}</p>

      <section className="gc-card" style={{ padding: 16, marginBottom: 16 }}>
        <h2>Session</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            placeholder="SUPER_ADMIN_LOGIN_SECRET"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            style={{ minWidth: 320 }}
          />
          <input
            placeholder="actor"
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            style={{ minWidth: 180 }}
          />
          <button onClick={() => void login()}>Login</button>
          <button onClick={() => void logout()}>Logout</button>
          <button onClick={() => void loadAll()}>Reload</button>
        </div>
      </section>

      <section className="gc-card" style={{ padding: 16, marginBottom: 16 }}>
        <h2>Plans</h2>
        <div style={{ display: "grid", gap: 8 }}>
          {sortedPlans.map((plan) => (
            <div key={plan.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <strong style={{ minWidth: 120 }}>{plan.code}</strong>
              <span>{plan.name}</span>
              <span>({plan.currency})</span>
              <input
                type="number"
                step="0.01"
                value={priceDraft[plan.id] ?? (plan.priceCents / 100).toFixed(2)}
                onChange={(e) => setPriceDraft((prev) => ({ ...prev, [plan.id]: e.target.value }))}
                style={{ width: 120 }}
              />
              <button onClick={() => void savePlanPrice(plan)}>Save Price</button>
            </div>
          ))}
        </div>
      </section>

      <section className="gc-card" style={{ padding: 16, marginBottom: 16 }}>
        <h2>Plan Features / Limits</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <select
            value={selectedPlanId}
            onChange={(e) => setSelectedPlanId(e.target.value)}
            style={{ minWidth: 220 }}
          >
            <option value="">select plan</option>
            {sortedPlans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.code} ({plan.name})
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              if (selectedPlanId) {
                void loadPlanFeatures(selectedPlanId);
              }
            }}
          >
            Load Features
          </button>
          <button onClick={() => void savePlanFeatures()}>Save Features</button>
        </div>
        <textarea
          value={featureJsonDraft}
          onChange={(e) => setFeatureJsonDraft(e.target.value)}
          rows={14}
          style={{ width: "100%", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 13 }}
          placeholder='[{"featureKey":"max_staff","featureType":"number","valueJson":3}]'
        />
      </section>

      <section className="gc-card" style={{ padding: 16, marginBottom: 16 }}>
        <h2>Publish / Rollback</h2>
        <div style={{ marginBottom: 8 }}>
          baseline version: {baselineVersion ?? "none"} | changes: {planDiffItems.length}
        </div>
        <div style={{ display: "grid", gap: 4, marginBottom: 10 }}>
          {planDiffItems.length === 0 ? (
            <div>No diff with latest published version</div>
          ) : (
            planDiffItems.map((item) => (
              <div key={`${item.code}-${item.changeType}`}>
                {item.code}: {item.changeType}
              </div>
            ))
          )}
        </div>
        <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <input
            type="checkbox"
            checked={publishConfirmed}
            onChange={(e) => setPublishConfirmed(e.target.checked)}
          />
          confirm publish current snapshot
        </label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <button onClick={() => void publishPlans()}>Publish Current Snapshot</button>
          <input
            placeholder="version"
            value={rollbackVersion}
            onChange={(e) => setRollbackVersion(e.target.value)}
            style={{ width: 120 }}
          />
          <button onClick={() => void rollbackPlans()}>Rollback To Version</button>
        </div>
        <div style={{ display: "grid", gap: 4 }}>
          {versions.map((item) => (
            <div key={`${item.version}-${item.publishedAt ?? "n"}`}>
              v{item.version} - {item.status} - {item.publishedBy ?? "-"} - {item.publishedAt ?? "-"}
            </div>
          ))}
        </div>
      </section>

      <section className="gc-card" style={{ padding: 16, marginBottom: 16 }}>
        <h2>Assign Tenant Plan (Next Cycle)</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <input
            placeholder="tenantId"
            value={assignTenantId}
            onChange={(e) => setAssignTenantId(e.target.value)}
            style={{ minWidth: 320 }}
          />
          <select value={assignPlanCode} onChange={(e) => setAssignPlanCode(e.target.value)}>
            {sortedPlans.map((plan) => (
              <option key={plan.code} value={plan.code}>
                {plan.code}
              </option>
            ))}
          </select>
          <button onClick={() => void assignPlanToTenant()}>Schedule Change</button>
        </div>
        <div style={{ display: "grid", gap: 4 }}>
          {tenants.map((tenant) => (
            <div key={tenant.tenantId}>
              {tenant.tenantSlug} ({tenant.tenantName}) - current: {tenant.planCode ?? "none"} - pending: {tenant.pendingPlanCode ?? "none"}
            </div>
          ))}
        </div>
      </section>

      <section className="gc-card" style={{ padding: 16, marginBottom: 16 }}>
        <h2>Audit Log</h2>
        <div style={{ display: "grid", gap: 6 }}>
          {auditRows.length === 0 ? (
            <div>No entries</div>
          ) : (
            auditRows.map((item) => (
              <div key={item.id}>
                {item.createdAt} | {item.actor} | {item.action} | {item.entity}:{item.entityId}
              </div>
            ))
          )}
        </div>
      </section>
    </main>
  );
}
