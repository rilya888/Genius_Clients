import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { superAdminRequest } from "../shared/api/superAdminApi";

type Plan = {
  id: string;
  code: string;
  name: string;
  priceCents: number;
  currency: string;
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

export function SuperAdminPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<string>("");
  const [actor, setActor] = useState("super_admin");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [versions, setVersions] = useState<PlanVersion[]>([]);
  const [tenants, setTenants] = useState<TenantOverview[]>([]);
  const [auditRows, setAuditRows] = useState<AuditLogRow[]>([]);
  const [planDiffItems, setPlanDiffItems] = useState<PlanDiffItem[]>([]);
  const [baselineVersion, setBaselineVersion] = useState<number | null>(null);
  const [priceDraft, setPriceDraft] = useState<Record<string, string>>({});
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [featureJsonDraft, setFeatureJsonDraft] = useState("");
  const [assignTenantId, setAssignTenantId] = useState("");
  const [assignPlanCode, setAssignPlanCode] = useState("starter");
  const [rollbackVersion, setRollbackVersion] = useState("");
  const [publishConfirmed, setPublishConfirmed] = useState(false);

  const sortedPlans = useMemo(
    () => [...plans].sort((a, b) => a.sortOrder - b.sortOrder),
    [plans]
  );
  const selectedPlan = useMemo(
    () => sortedPlans.find((plan) => plan.id === selectedPlanId) ?? null,
    [sortedPlans, selectedPlanId]
  );

  async function loadAll() {
    const [plansResult, versionsResult, tenantsResult, auditResult, diffResult] = await Promise.all([
      superAdminRequest<{ items: Plan[] }>("/api/v1/super-admin/plans"),
      superAdminRequest<{ items: PlanVersion[] }>("/api/v1/super-admin/plan-versions"),
      superAdminRequest<{ items: TenantOverview[] }>("/api/v1/super-admin/tenants"),
      superAdminRequest<{ items: AuditLogRow[] }>("/api/v1/super-admin/audit-log?limit=100"),
      superAdminRequest<{ baselineVersion: number | null; items: PlanDiffItem[] }>(
        "/api/v1/super-admin/plans/diff"
      )
    ]);

    if (!plansResult.ok) {
      if (plansResult.status === 401 || plansResult.status === 403) {
        navigate("/super-admin/login", { replace: true });
        return;
      }
      setStatus(plansResult.error?.message ?? "Failed to load plans");
      return;
    }

    setPlans(plansResult.data?.items ?? []);
    setVersions(versionsResult.data?.items ?? []);
    setTenants(tenantsResult.data?.items ?? []);
    setAuditRows(auditResult.data?.items ?? []);
    setPlanDiffItems(diffResult.data?.items ?? []);
    setBaselineVersion(diffResult.data?.baselineVersion ?? null);
    setPublishConfirmed(false);
    setStatus("Data loaded");
  }

  useEffect(() => {
    void loadAll();
  }, []);

  return (
    <section className="section">
      <div className="settings-card" style={{ marginBottom: 12 }}>
        <h1 style={{ marginTop: 0 }}>Super Admin</h1>
        <p style={{ marginTop: 0, color: "var(--text-muted)" }}>{status}</p>
        <label>
          Actor
          <input value={actor} onChange={(event) => setActor(event.target.value)} />
        </label>
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <button
            className="btn btn-ghost"
            onClick={() => {
              void loadAll();
            }}
          >
            Reload
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => {
              void superAdminRequest("/api/v1/super-admin/auth/logout", { method: "POST", body: "{}" }).then(
                () => navigate("/super-admin/login", { replace: true })
              );
            }}
          >
            Logout
          </button>
        </div>
      </div>

      <div className="settings-card" style={{ marginBottom: 12 }}>
        <h2 style={{ marginTop: 0 }}>Plans</h2>
        {sortedPlans.map((plan) => (
          <div key={plan.id} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
            <strong style={{ minWidth: 120 }}>{plan.code}</strong>
            <span>{plan.name}</span>
            <input
              type="number"
              step="0.01"
              value={priceDraft[plan.id] ?? (plan.priceCents / 100).toFixed(2)}
              onChange={(event) =>
                setPriceDraft((prev) => ({ ...prev, [plan.id]: event.target.value }))
              }
              style={{ width: 120 }}
            />
            <button
              className="btn btn-ghost"
              onClick={() => {
                const nextPrice = Number(priceDraft[plan.id] ?? plan.priceCents / 100);
                if (!Number.isFinite(nextPrice) || nextPrice < 0) {
                  setStatus("Invalid price");
                  return;
                }
                void superAdminRequest(`/api/v1/super-admin/plans/${plan.id}`, {
                  method: "PUT",
                  body: JSON.stringify({ priceCents: Math.round(nextPrice * 100), actor })
                }).then(async (result) => {
                  if (!result.ok) {
                    setStatus(result.error?.message ?? "Plan update failed");
                    return;
                  }
                  setStatus(`Plan ${plan.code} updated`);
                  await loadAll();
                });
              }}
            >
              Save Price
            </button>
          </div>
        ))}
      </div>

      <div className="settings-card" style={{ marginBottom: 12 }}>
        <h2 style={{ marginTop: 0 }}>Plan Features / Limits</h2>
        <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          <select value={selectedPlanId} onChange={(event) => setSelectedPlanId(event.target.value)}>
            <option value="">select plan</option>
            {sortedPlans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.code} ({plan.name})
              </option>
            ))}
          </select>
          <button
            className="btn btn-ghost"
            onClick={() => {
              if (!selectedPlanId) {
                setStatus("Select plan first");
                return;
              }
              void superAdminRequest<{ items: PlanFeature[] }>(
                `/api/v1/super-admin/plans/${selectedPlanId}/features`
              ).then((result) => {
                if (!result.ok) {
                  setStatus(result.error?.message ?? "Failed to load features");
                  return;
                }
                const items = result.data?.items ?? [];
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
              });
            }}
          >
            Load Features
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => {
              if (!selectedPlan) {
                setStatus("Select plan first");
                return;
              }
              let parsed: unknown;
              try {
                parsed = JSON.parse(featureJsonDraft);
              } catch {
                setStatus("Features JSON invalid");
                return;
              }
              if (!Array.isArray(parsed)) {
                setStatus("Features JSON must be array");
                return;
              }
              void superAdminRequest(`/api/v1/super-admin/plans/${selectedPlan.id}/features`, {
                method: "PUT",
                body: JSON.stringify({ items: parsed, actor })
              }).then(async (result) => {
                if (!result.ok) {
                  setStatus(result.error?.message ?? "Failed to save plan features");
                  return;
                }
                setStatus(`Features for ${selectedPlan.code} updated`);
                await loadAll();
              });
            }}
          >
            Save Features
          </button>
        </div>
        <textarea
          rows={12}
          value={featureJsonDraft}
          onChange={(event) => setFeatureJsonDraft(event.target.value)}
          style={{ width: "100%", fontFamily: "monospace" }}
        />
      </div>

      <div className="settings-card" style={{ marginBottom: 12 }}>
        <h2 style={{ marginTop: 0 }}>Publish Center</h2>
        <p style={{ marginTop: 0 }}>
          baseline version: {baselineVersion ?? "none"} | changes: {planDiffItems.length}
        </p>
        {planDiffItems.length === 0 ? <p>No diff with latest published version</p> : null}
        {planDiffItems.map((item) => (
          <p key={`${item.code}-${item.changeType}`}>{item.code}: {item.changeType}</p>
        ))}
        <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <input
            type="checkbox"
            checked={publishConfirmed}
            onChange={(event) => setPublishConfirmed(event.target.checked)}
          />
          confirm publish current snapshot
        </label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className="btn btn-primary"
            onClick={() => {
              if (!publishConfirmed) {
                setStatus("Confirm publish first");
                return;
              }
              void superAdminRequest<{ version: number }>("/api/v1/super-admin/plans/publish", {
                method: "POST",
                body: JSON.stringify({ actor })
              }).then(async (result) => {
                if (!result.ok) {
                  setStatus(result.error?.message ?? "Publish failed");
                  return;
                }
                setStatus(`Published version ${result.data?.version ?? "?"}`);
                await loadAll();
              });
            }}
          >
            Publish
          </button>
          <input
            placeholder="version"
            value={rollbackVersion}
            onChange={(event) => setRollbackVersion(event.target.value)}
            style={{ width: 120 }}
          />
          <button
            className="btn btn-ghost"
            onClick={() => {
              const version = Number(rollbackVersion);
              if (!Number.isInteger(version) || version < 1) {
                setStatus("Rollback version is invalid");
                return;
              }
              void superAdminRequest<{ version: number }>(`/api/v1/super-admin/plans/rollback/${version}`, {
                method: "POST",
                body: JSON.stringify({ actor })
              }).then(async (result) => {
                if (!result.ok) {
                  setStatus(result.error?.message ?? "Rollback failed");
                  return;
                }
                setStatus(`Rollback done. New version ${result.data?.version ?? "?"}`);
                await loadAll();
              });
            }}
          >
            Rollback
          </button>
        </div>
        <div style={{ marginTop: 8 }}>
          {versions.map((item) => (
            <p key={`${item.version}-${item.publishedAt ?? "none"}`}>
              v{item.version} - {item.status} - {item.publishedBy ?? "-"} - {item.publishedAt ?? "-"}
            </p>
          ))}
        </div>
      </div>

      <div className="settings-card" style={{ marginBottom: 12 }}>
        <h2 style={{ marginTop: 0 }}>Tenant Mapping</h2>
        <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          <input
            placeholder="tenantId"
            value={assignTenantId}
            onChange={(event) => setAssignTenantId(event.target.value)}
            style={{ minWidth: 300 }}
          />
          <select value={assignPlanCode} onChange={(event) => setAssignPlanCode(event.target.value)}>
            {sortedPlans.map((plan) => (
              <option key={plan.code} value={plan.code}>
                {plan.code}
              </option>
            ))}
          </select>
          <button
            className="btn btn-ghost"
            onClick={() => {
              if (!assignTenantId.trim()) {
                setStatus("Tenant ID required");
                return;
              }
              void superAdminRequest(`/api/v1/super-admin/tenants/${assignTenantId.trim()}/subscription`, {
                method: "PUT",
                body: JSON.stringify({ planCode: assignPlanCode, actor })
              }).then(async (result) => {
                if (!result.ok) {
                  setStatus(result.error?.message ?? "Tenant subscription update failed");
                  return;
                }
                setStatus("Tenant subscription updated");
                await loadAll();
              });
            }}
          >
            Schedule Change
          </button>
        </div>
        {tenants.map((tenant) => (
          <p key={tenant.tenantId}>
            {tenant.tenantSlug} ({tenant.tenantName}) - current: {tenant.planCode ?? "none"} - pending:{" "}
            {tenant.pendingPlanCode ?? "none"}
          </p>
        ))}
      </div>

      <div className="settings-card">
        <h2 style={{ marginTop: 0 }}>Audit Log</h2>
        {auditRows.length === 0 ? <p>No entries</p> : null}
        {auditRows.map((item) => (
          <p key={item.id}>
            {item.createdAt} | {item.actor} | {item.action} | {item.entity}:{item.entityId}
          </p>
        ))}
      </div>
    </section>
  );
}
