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
  desiredWhatsappBotE164: string | null;
  operatorWhatsappE164: string | null;
  whatsappSetup: {
    desiredBotNumber: string | null;
    operatorNumber: string | null;
    status:
      | "not_started"
      | "incomplete"
      | "numbers_provided"
      | "pending_meta_connection"
      | "connected"
      | "action_required";
    connectedEndpointId: string | null;
    connectedDisplayPhoneNumber: string | null;
    requiresAction: boolean;
    statusReason: string;
  };
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

type SystemSettings = {
  authEmailVerificationRequired: boolean;
  source: "runtime" | "env_default";
  envDefault: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
};

type WhatsAppEndpoint = {
  id: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  accountId: string;
  salonId: string;
  externalEndpointId: string;
  environment: "sandbox" | "production";
  bindingStatus: "draft" | "pending_verification" | "connected" | "disabled";
  displayName: string | null;
  displayPhoneNumber: string | null;
  e164: string | null;
  verifiedName: string | null;
  wabaId: string | null;
  businessId: string | null;
  tokenSource: "unknown" | "map" | "fallback";
  templateStatus: "unknown" | "not_ready" | "ready";
  profileStatus: "unknown" | "incomplete" | "ready";
  qualityRating: string | null;
  metaStatus: string | null;
  codeVerificationStatus: string | null;
  notes: string | null;
  isActive: boolean;
  connectedAt: string | null;
  disconnectedAt: string | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  tokenConfigured: boolean;
  tokenSourceResolved: "unknown" | "map" | "fallback";
  tokenHealthStatus: "ok" | "error" | "unknown" | "missing";
  tokenHealthHttpStatus: number | null;
};

type WhatsAppEndpointSummary = {
  total: number;
  connected: number;
  sandbox: number;
  production: number;
  tokenMissing: number;
};

type WhatsAppEndpointDraft = {
  id: string;
  tenantId: string;
  externalEndpointId: string;
  environment: "sandbox" | "production";
  bindingStatus: "draft" | "pending_verification" | "connected" | "disabled";
  displayName: string;
  displayPhoneNumber: string;
  e164: string;
  verifiedName: string;
  wabaId: string;
  businessId: string;
  tokenSource: "unknown" | "map" | "fallback";
  templateStatus: "unknown" | "not_ready" | "ready";
  profileStatus: "unknown" | "incomplete" | "ready";
  qualityRating: string;
  metaStatus: string;
  codeVerificationStatus: string;
  notes: string;
  isActive: boolean;
};

type WhatsAppProvisioningStatusResponse = {
  activeJob: {
    id: string;
    botNumberE164: string;
    operatorNumberE164: string;
    status: string;
    step: string;
    errorCode: string | null;
    errorMessage: string | null;
    updatedAt: string;
  } | null;
  latestJob: {
    id: string;
    botNumberE164: string;
    operatorNumberE164: string;
    status: string;
    step: string;
    errorCode: string | null;
    errorMessage: string | null;
    updatedAt: string;
  } | null;
  otpSession: {
    id: string;
    state: string;
    verificationMethod: string;
    attempts: number;
    maxAttempts: number;
    otpExpiresAt: string | null;
  } | null;
  activeBinding: {
    id: string;
    botNumberE164: string;
    operatorNumberE164: string;
    phoneNumberId: string;
    isActive: boolean;
    updatedAt: string;
  } | null;
  latestBinding: {
    id: string;
    botNumberE164: string;
    operatorNumberE164: string;
    phoneNumberId: string;
    isActive: boolean;
    updatedAt: string;
  } | null;
};

const EMPTY_WHATSAPP_ENDPOINT_DRAFT: WhatsAppEndpointDraft = {
  id: "",
  tenantId: "",
  externalEndpointId: "",
  environment: "production",
  bindingStatus: "draft",
  displayName: "",
  displayPhoneNumber: "",
  e164: "",
  verifiedName: "",
  wabaId: "",
  businessId: "",
  tokenSource: "unknown",
  templateStatus: "unknown",
  profileStatus: "unknown",
  qualityRating: "",
  metaStatus: "",
  codeVerificationStatus: "",
  notes: "",
  isActive: true
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
  const [tenantQuery, setTenantQuery] = useState("");
  const [tenantPlanFilter, setTenantPlanFilter] = useState("all");
  const [slugTenantId, setSlugTenantId] = useState("");
  const [slugDraft, setSlugDraft] = useState("");
  const [rollbackVersion, setRollbackVersion] = useState("");
  const [publishConfirmed, setPublishConfirmed] = useState(false);
  const [systemSettings, setSystemSettings] = useState<SystemSettings | null>(null);
  const [emailVerificationRequiredDraft, setEmailVerificationRequiredDraft] = useState(true);
  const [whatsAppEndpoints, setWhatsAppEndpoints] = useState<WhatsAppEndpoint[]>([]);
  const [whatsAppSummary, setWhatsAppSummary] = useState<WhatsAppEndpointSummary | null>(null);
  const [whatsAppDraft, setWhatsAppDraft] = useState<WhatsAppEndpointDraft>(EMPTY_WHATSAPP_ENDPOINT_DRAFT);
  const [provisionTenantId, setProvisionTenantId] = useState("");
  const [provisionBotNumber, setProvisionBotNumber] = useState("");
  const [provisionOperatorNumber, setProvisionOperatorNumber] = useState("");
  const [provisionPhoneNumberId, setProvisionPhoneNumberId] = useState("");
  const [provisionJobId, setProvisionJobId] = useState("");
  const [provisionOtpCode, setProvisionOtpCode] = useState("");
  const [provisionOtpMethod, setProvisionOtpMethod] = useState<"sms" | "voice">("sms");
  const [provisionStatus, setProvisionStatus] = useState<WhatsAppProvisioningStatusResponse | null>(null);

  const sortedPlans = useMemo(
    () => [...plans].sort((a, b) => a.sortOrder - b.sortOrder),
    [plans]
  );
  const selectedPlan = useMemo(
    () => sortedPlans.find((plan) => plan.id === selectedPlanId) ?? null,
    [sortedPlans, selectedPlanId]
  );
  const selectedWhatsAppTenant = useMemo(
    () => tenants.find((tenant) => tenant.tenantId === whatsAppDraft.tenantId) ?? null,
    [tenants, whatsAppDraft.tenantId]
  );
  const selectedProvisionTenant = useMemo(
    () => tenants.find((tenant) => tenant.tenantId === provisionTenantId) ?? null,
    [tenants, provisionTenantId]
  );

  async function loadAll() {
    const tenantParams = new URLSearchParams({ limit: "500" });
    const normalizedTenantQuery = tenantQuery.trim();
    if (normalizedTenantQuery) {
      tenantParams.set("q", normalizedTenantQuery);
    }
    if (tenantPlanFilter !== "all") {
      tenantParams.set("planCode", tenantPlanFilter);
    }

    const [plansResult, versionsResult, tenantsResult, auditResult, diffResult, settingsResult, endpointsResult] =
      await Promise.all([
      superAdminRequest<{ items: Plan[] }>("/api/v1/super-admin/plans"),
      superAdminRequest<{ items: PlanVersion[] }>("/api/v1/super-admin/plan-versions"),
      superAdminRequest<{ items: TenantOverview[] }>(`/api/v1/super-admin/tenants?${tenantParams.toString()}`),
      superAdminRequest<{ items: AuditLogRow[] }>("/api/v1/super-admin/audit-log?limit=100"),
      superAdminRequest<{ baselineVersion: number | null; items: PlanDiffItem[] }>(
        "/api/v1/super-admin/plans/diff"
      ),
      superAdminRequest<SystemSettings>("/api/v1/super-admin/system-settings"),
      superAdminRequest<{ items: WhatsAppEndpoint[]; summary: WhatsAppEndpointSummary }>(
        "/api/v1/super-admin/whatsapp/endpoints"
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
    const loadedTenants = tenantsResult.data?.items ?? [];
    setTenants(loadedTenants);
    if (!slugTenantId && loadedTenants[0]) {
      setSlugTenantId(loadedTenants[0].tenantId);
      setSlugDraft(loadedTenants[0].tenantSlug);
    } else if (slugTenantId && !loadedTenants.some((item) => item.tenantId === slugTenantId)) {
      setSlugTenantId("");
      setSlugDraft("");
    }
    setAuditRows(auditResult.data?.items ?? []);
    setPlanDiffItems(diffResult.data?.items ?? []);
    setBaselineVersion(diffResult.data?.baselineVersion ?? null);
    const loadedSystemSettings = settingsResult.data ?? null;
    setSystemSettings(loadedSystemSettings);
    setEmailVerificationRequiredDraft(loadedSystemSettings?.authEmailVerificationRequired ?? true);
    setWhatsAppEndpoints(endpointsResult.data?.items ?? []);
    setWhatsAppSummary(endpointsResult.data?.summary ?? null);
    setPublishConfirmed(false);
    setStatus("Data loaded");
  }

  useEffect(() => {
    void loadAll();
  }, []);

  function loadWhatsAppDraft(endpoint: WhatsAppEndpoint) {
    setWhatsAppDraft({
      id: endpoint.id,
      tenantId: endpoint.tenantId,
      externalEndpointId: endpoint.externalEndpointId,
      environment: endpoint.environment,
      bindingStatus: endpoint.bindingStatus,
      displayName: endpoint.displayName ?? "",
      displayPhoneNumber: endpoint.displayPhoneNumber ?? "",
      e164: endpoint.e164 ?? "",
      verifiedName: endpoint.verifiedName ?? "",
      wabaId: endpoint.wabaId ?? "",
      businessId: endpoint.businessId ?? "",
      tokenSource: endpoint.tokenSource,
      templateStatus: endpoint.templateStatus,
      profileStatus: endpoint.profileStatus,
      qualityRating: endpoint.qualityRating ?? "",
      metaStatus: endpoint.metaStatus ?? "",
      codeVerificationStatus: endpoint.codeVerificationStatus ?? "",
      notes: endpoint.notes ?? "",
      isActive: endpoint.isActive
    });
  }

  function buildWhatsAppNotesFromTenant(tenant: TenantOverview, currentNotes: string) {
    const trimmedCurrent = currentNotes.trim();
    if (trimmedCurrent.length > 0) {
      return currentNotes;
    }

    const lines = [
      `Tenant slug: ${tenant.tenantSlug}`,
      `Tenant name: ${tenant.tenantName}`,
      `Requested operator number: ${tenant.operatorWhatsappE164 ?? "n/a"}`,
      `Requested setup status: ${tenant.whatsappSetup.status}`
    ];
    return lines.join("\n");
  }

  function prefillWhatsAppDraftFromTenant(tenant: TenantOverview) {
    setWhatsAppDraft((prev) => ({
      ...prev,
      id: prev.id && prev.tenantId === tenant.tenantId ? prev.id : "",
      tenantId: tenant.tenantId,
      e164: tenant.desiredWhatsappBotE164 ?? prev.e164,
      displayPhoneNumber:
        prev.displayPhoneNumber.trim().length > 0
          ? prev.displayPhoneNumber
          : tenant.desiredWhatsappBotE164 ?? "",
      displayName:
        prev.displayName.trim().length > 0
          ? prev.displayName
          : tenant.tenantName.slice(0, 80),
      verifiedName:
        prev.verifiedName.trim().length > 0
          ? prev.verifiedName
          : tenant.tenantName.slice(0, 80),
      notes: buildWhatsAppNotesFromTenant(tenant, prev.notes)
    }));
    setStatus(`WhatsApp draft prefilled from tenant ${tenant.tenantSlug}`);
  }

  async function loadProvisionStatus(tenantId: string) {
    if (!tenantId.trim()) {
      setStatus("Select tenant for provisioning status");
      return;
    }
    const result = await superAdminRequest<WhatsAppProvisioningStatusResponse>(
      `/api/v1/super-admin/tenants/${tenantId}/whatsapp/provision/status`
    );
    if (!result.ok) {
      setStatus(result.error?.message ?? "Failed to load provisioning status");
      return;
    }
    const payload = result.data ?? null;
    setProvisionStatus(payload);
    const jobId = payload?.activeJob?.id ?? payload?.latestJob?.id ?? "";
    if (jobId) {
      setProvisionJobId(jobId);
    }
    setStatus("Provisioning status loaded");
  }

  function prefillProvisionFromTenant(tenant: TenantOverview) {
    setProvisionTenantId(tenant.tenantId);
    setProvisionBotNumber(tenant.desiredWhatsappBotE164 ?? "");
    setProvisionOperatorNumber(tenant.operatorWhatsappE164 ?? "");
    setProvisionPhoneNumberId("");
    setProvisionOtpCode("");
    setProvisionJobId("");
    setProvisionStatus(null);
    setStatus(`Provisioning draft prefilled from tenant ${tenant.tenantSlug}`);
  }

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
        <h2 style={{ marginTop: 0 }}>System Settings</h2>
        <p style={{ marginTop: 0 }}>
          Email verification required for write operations:{" "}
          <strong>{emailVerificationRequiredDraft ? "enabled" : "disabled"}</strong>
        </p>
        <p style={{ marginTop: 0, color: "var(--text-muted)" }}>
          Source: {systemSettings?.source ?? "unknown"} | ENV default:{" "}
          {systemSettings?.envDefault ? "enabled" : "disabled"}
          {systemSettings?.updatedBy ? ` | updated by: ${systemSettings.updatedBy}` : ""}
        </p>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={emailVerificationRequiredDraft}
            onChange={(event) => setEmailVerificationRequiredDraft(event.target.checked)}
          />
          Require verified email for POST/PUT/PATCH/DELETE endpoints
        </label>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button
            className="btn btn-ghost"
            onClick={() => {
              void superAdminRequest<SystemSettings>("/api/v1/super-admin/system-settings", {
                method: "PATCH",
                body: JSON.stringify({
                  authEmailVerificationRequired: emailVerificationRequiredDraft,
                  actor
                })
              }).then(async (result) => {
                if (!result.ok) {
                  setStatus(result.error?.message ?? "System settings update failed");
                  return;
                }
                setStatus("System settings updated");
                await loadAll();
              });
            }}
          >
            Save Setting
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
        <h2 style={{ marginTop: 0 }}>Tenants</h2>
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
        <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          <input
            placeholder="search by slug/name/id"
            value={tenantQuery}
            onChange={(event) => setTenantQuery(event.target.value)}
            style={{ minWidth: 260 }}
          />
          <select value={tenantPlanFilter} onChange={(event) => setTenantPlanFilter(event.target.value)}>
            <option value="all">all plans</option>
            <option value="none">no subscription</option>
            {sortedPlans.map((plan) => (
              <option key={`filter-${plan.code}`} value={plan.code}>
                {plan.code}
              </option>
            ))}
          </select>
          <button
            className="btn btn-ghost"
            onClick={() => {
              void loadAll();
            }}
          >
            Apply Filter
          </button>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          <select
            value={slugTenantId}
            onChange={(event) => {
              const nextTenantId = event.target.value;
              setSlugTenantId(nextTenantId);
              const nextTenant = tenants.find((item) => item.tenantId === nextTenantId);
              if (nextTenant) {
                setSlugDraft(nextTenant.tenantSlug);
              }
            }}
          >
            <option value="">select tenant for slug change</option>
            {tenants.map((tenant) => (
              <option key={`slug-${tenant.tenantId}`} value={tenant.tenantId}>
                {tenant.tenantSlug} ({tenant.tenantName})
              </option>
            ))}
          </select>
          <input
            placeholder="new slug"
            value={slugDraft}
            onChange={(event) => setSlugDraft(event.target.value)}
            style={{ minWidth: 220 }}
          />
          <button
            className="btn btn-ghost"
            onClick={() => {
              if (!slugTenantId) {
                setStatus("Select tenant for slug change");
                return;
              }
              const currentTenant = tenants.find((item) => item.tenantId === slugTenantId);
              if (!currentTenant) {
                setStatus("Selected tenant is not in current filter scope");
                return;
              }
              const nextSlug = slugDraft.trim();
              if (!nextSlug) {
                setStatus("New slug is required");
                return;
              }
              if (nextSlug === currentTenant.tenantSlug) {
                setStatus("Slug is already set to this value");
                return;
              }
              if (!window.confirm(`Change tenant slug from ${currentTenant.tenantSlug} to ${nextSlug}?`)) {
                return;
              }
              void superAdminRequest(`/api/v1/super-admin/tenants/${slugTenantId}/slug`, {
                method: "PUT",
                body: JSON.stringify({ slug: nextSlug, actor })
              }).then(async (result) => {
                if (!result.ok) {
                  setStatus(result.error?.message ?? "Tenant slug update failed");
                  return;
                }
                setStatus("Tenant slug updated");
                await loadAll();
              });
            }}
          >
            Change Slug
          </button>
        </div>
        {tenants.map((tenant) => (
          <div key={tenant.tenantId} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: "1px solid rgba(26,56,56,0.08)" }}>
            <p style={{ margin: 0 }}>
              {tenant.tenantSlug} ({tenant.tenantName}) - current: {tenant.planCode ?? "none"} - pending:{" "}
              {tenant.pendingPlanCode ?? "none"}
            </p>
            <p style={{ margin: "4px 0 0 0", color: "var(--text-muted)" }}>
              bot: {tenant.desiredWhatsappBotE164 ?? "n/a"} | operator: {tenant.operatorWhatsappE164 ?? "n/a"} |
              setup: {tenant.whatsappSetup.status}
              {tenant.whatsappSetup.connectedDisplayPhoneNumber
                ? ` | connected: ${tenant.whatsappSetup.connectedDisplayPhoneNumber}`
                : ""}
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  prefillWhatsAppDraftFromTenant(tenant);
                }}
              >
                Use for WhatsApp draft
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  prefillProvisionFromTenant(tenant);
                }}
              >
                Use for auto provisioning
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="settings-card" style={{ marginBottom: 12 }}>
        <h2 style={{ marginTop: 0 }}>WhatsApp Auto Provisioning</h2>
        <p style={{ marginTop: 0, color: "var(--text-muted)" }}>
          Start provisioning, request OTP, confirm OTP, and retry failed runs without manual DB edits.
        </p>
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          <label>
            Tenant
            <select
              value={provisionTenantId}
              onChange={(event) => {
                const tenantId = event.target.value;
                setProvisionTenantId(tenantId);
                const tenant = tenants.find((item) => item.tenantId === tenantId) ?? null;
                if (!tenant) {
                  return;
                }
                setProvisionBotNumber(tenant.desiredWhatsappBotE164 ?? "");
                setProvisionOperatorNumber(tenant.operatorWhatsappE164 ?? "");
              }}
            >
              <option value="">select tenant</option>
              {tenants.map((tenant) => (
                <option key={`provision-tenant-${tenant.tenantId}`} value={tenant.tenantId}>
                  {tenant.tenantSlug} ({tenant.tenantName})
                </option>
              ))}
            </select>
          </label>
          <label>
            Bot number (E.164)
            <input
              value={provisionBotNumber}
              onChange={(event) => setProvisionBotNumber(event.target.value)}
              placeholder="+393..."
            />
          </label>
          <label>
            Operator number (E.164)
            <input
              value={provisionOperatorNumber}
              onChange={(event) => setProvisionOperatorNumber(event.target.value)}
              placeholder="+393..."
            />
          </label>
          <label>
            Phone Number ID (optional if mapped)
            <input
              value={provisionPhoneNumberId}
              onChange={(event) => setProvisionPhoneNumberId(event.target.value)}
              placeholder="1234567890"
            />
          </label>
          <label>
            OTP method
            <select
              value={provisionOtpMethod}
              onChange={(event) => setProvisionOtpMethod(event.target.value as "sms" | "voice")}
            >
              <option value="sms">sms</option>
              <option value="voice">voice</option>
            </select>
          </label>
          <label>
            Job ID
            <input
              value={provisionJobId}
              onChange={(event) => setProvisionJobId(event.target.value)}
              placeholder="auto-filled from status"
            />
          </label>
          <label>
            OTP code
            <input
              value={provisionOtpCode}
              onChange={(event) => setProvisionOtpCode(event.target.value)}
              placeholder="123456"
            />
          </label>
        </div>
        {selectedProvisionTenant ? (
          <p style={{ marginTop: 8, color: "var(--text-muted)" }}>
            tenant: <strong>{selectedProvisionTenant.tenantSlug}</strong> | current requested bot:{" "}
            <strong>{selectedProvisionTenant.desiredWhatsappBotE164 ?? "n/a"}</strong> | operator:{" "}
            <strong>{selectedProvisionTenant.operatorWhatsappE164 ?? "n/a"}</strong>
          </p>
        ) : null}
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <button
            className="btn btn-ghost"
            onClick={() => {
              if (!provisionTenantId.trim()) {
                setStatus("Select tenant first");
                return;
              }
              void loadProvisionStatus(provisionTenantId.trim());
            }}
          >
            Load Status
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              if (!provisionTenantId.trim() || !provisionBotNumber.trim() || !provisionOperatorNumber.trim()) {
                setStatus("Tenant, bot number, and operator number are required");
                return;
              }
              void superAdminRequest<{ job: { id: string }; requiresOtp: boolean }>(
                `/api/v1/super-admin/tenants/${provisionTenantId.trim()}/whatsapp/provision/start`,
                {
                  method: "POST",
                  body: JSON.stringify({
                    botNumber: provisionBotNumber.trim(),
                    operatorNumber: provisionOperatorNumber.trim(),
                    verificationMethod: provisionOtpMethod,
                    phoneNumberId: provisionPhoneNumberId.trim() || undefined,
                    actor
                  })
                }
              ).then(async (result) => {
                if (!result.ok) {
                  setStatus(result.error?.message ?? "Provisioning start failed");
                  return;
                }
                const nextJobId = result.data?.job?.id ?? "";
                if (nextJobId) {
                  setProvisionJobId(nextJobId);
                }
                setStatus("Provisioning started");
                await loadAll();
                await loadProvisionStatus(provisionTenantId.trim());
              });
            }}
          >
            Start
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => {
              if (!provisionTenantId.trim() || !provisionJobId.trim()) {
                setStatus("Tenant and job ID are required");
                return;
              }
              void superAdminRequest<{ job: { id: string } }>(
                `/api/v1/super-admin/tenants/${provisionTenantId.trim()}/whatsapp/provision/request-otp`,
                {
                  method: "POST",
                  body: JSON.stringify({
                    jobId: provisionJobId.trim(),
                    verificationMethod: provisionOtpMethod,
                    actor
                  })
                }
              ).then(async (result) => {
                if (!result.ok) {
                  setStatus(result.error?.message ?? "OTP request failed");
                  return;
                }
                setStatus("OTP requested");
                await loadProvisionStatus(provisionTenantId.trim());
              });
            }}
          >
            Request OTP
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => {
              if (!provisionTenantId.trim() || !provisionJobId.trim() || !provisionOtpCode.trim()) {
                setStatus("Tenant, job ID, and OTP code are required");
                return;
              }
              void superAdminRequest<{ job: { id: string } }>(
                `/api/v1/super-admin/tenants/${provisionTenantId.trim()}/whatsapp/provision/confirm-otp`,
                {
                  method: "POST",
                  body: JSON.stringify({
                    jobId: provisionJobId.trim(),
                    code: provisionOtpCode.trim(),
                    actor
                  })
                }
              ).then(async (result) => {
                if (!result.ok) {
                  setStatus(result.error?.message ?? "OTP confirm failed");
                  return;
                }
                setStatus("OTP confirmed and routing activated");
                setProvisionOtpCode("");
                await loadAll();
                await loadProvisionStatus(provisionTenantId.trim());
              });
            }}
          >
            Confirm OTP
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => {
              if (!provisionTenantId.trim() || !provisionJobId.trim()) {
                setStatus("Tenant and job ID are required");
                return;
              }
              void superAdminRequest<{ job: { id: string }; nextAction: string }>(
                `/api/v1/super-admin/tenants/${provisionTenantId.trim()}/whatsapp/provision/retry`,
                {
                  method: "POST",
                  body: JSON.stringify({
                    jobId: provisionJobId.trim(),
                    actor
                  })
                }
              ).then(async (result) => {
                if (!result.ok) {
                  setStatus(result.error?.message ?? "Provisioning retry failed");
                  return;
                }
                setStatus(`Retry accepted. Next action: ${result.data?.nextAction ?? "n/a"}`);
                await loadProvisionStatus(provisionTenantId.trim());
              });
            }}
          >
            Retry
          </button>
        </div>
        {provisionStatus ? (
          <div
            style={{
              marginTop: 10,
              padding: "10px 12px",
              borderRadius: 16,
              background: "rgba(16, 185, 129, 0.08)"
            }}
          >
            <p style={{ margin: 0 }}>
              active job:{" "}
              {provisionStatus.activeJob
                ? `${provisionStatus.activeJob.id} | ${provisionStatus.activeJob.status} | ${provisionStatus.activeJob.step}`
                : "none"}
            </p>
            <p style={{ margin: "4px 0 0 0" }}>
              latest job:{" "}
              {provisionStatus.latestJob
                ? `${provisionStatus.latestJob.id} | ${provisionStatus.latestJob.status} | ${provisionStatus.latestJob.step}`
                : "none"}
            </p>
            <p style={{ margin: "4px 0 0 0" }}>
              otp:{" "}
              {provisionStatus.otpSession
                ? `${provisionStatus.otpSession.state} | ${provisionStatus.otpSession.verificationMethod} | attempts ${provisionStatus.otpSession.attempts}/${provisionStatus.otpSession.maxAttempts}`
                : "none"}
            </p>
            <p style={{ margin: "4px 0 0 0" }}>
              active binding:{" "}
              {provisionStatus.activeBinding
                ? `${provisionStatus.activeBinding.phoneNumberId} | ${provisionStatus.activeBinding.botNumberE164} | active`
                : "none"}
            </p>
            {provisionStatus.activeJob?.errorCode || provisionStatus.activeJob?.errorMessage ? (
              <p style={{ margin: "4px 0 0 0", color: "#a16207" }}>
                active job error: {provisionStatus.activeJob.errorCode ?? "unknown"} -{" "}
                {provisionStatus.activeJob.errorMessage ?? "n/a"}
              </p>
            ) : null}
            {provisionStatus.latestJob?.errorCode || provisionStatus.latestJob?.errorMessage ? (
              <p style={{ margin: "4px 0 0 0", color: "#a16207" }}>
                latest job error: {provisionStatus.latestJob.errorCode ?? "unknown"} -{" "}
                {provisionStatus.latestJob.errorMessage ?? "n/a"}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="settings-card" style={{ marginBottom: 12 }}>
        <h2 style={{ marginTop: 0 }}>WhatsApp Numbers</h2>
        <p style={{ marginTop: 0, color: "var(--text-muted)" }}>
          Registry for salon numbers, routing bindings, token coverage, and operational readiness.
        </p>
        <p style={{ marginTop: 0 }}>
          total: {whatsAppSummary?.total ?? 0} | connected: {whatsAppSummary?.connected ?? 0} | production:{" "}
          {whatsAppSummary?.production ?? 0} | sandbox: {whatsAppSummary?.sandbox ?? 0} | token missing:{" "}
          {whatsAppSummary?.tokenMissing ?? 0}
        </p>
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          <label>
            Tenant
            <select
              value={whatsAppDraft.tenantId}
              onChange={(event) => {
                const tenantId = event.target.value;
                const tenant = tenants.find((item) => item.tenantId === tenantId) ?? null;
                if (!tenant) {
                  setWhatsAppDraft((prev) => ({ ...prev, tenantId }));
                  return;
                }
                setWhatsAppDraft((prev) => ({
                  ...prev,
                  tenantId,
                  e164:
                    prev.e164.trim().length > 0 && prev.tenantId === tenantId
                      ? prev.e164
                      : tenant.desiredWhatsappBotE164 ?? prev.e164,
                  displayPhoneNumber:
                    prev.displayPhoneNumber.trim().length > 0 && prev.tenantId === tenantId
                      ? prev.displayPhoneNumber
                      : tenant.desiredWhatsappBotE164 ?? prev.displayPhoneNumber,
                  notes: buildWhatsAppNotesFromTenant(tenant, prev.notes)
                }));
              }}
            >
              <option value="">select tenant</option>
              {tenants.map((tenant) => (
                <option key={`wa-tenant-${tenant.tenantId}`} value={tenant.tenantId}>
                  {tenant.tenantSlug} ({tenant.tenantName})
                </option>
              ))}
            </select>
          </label>
          {selectedWhatsAppTenant ? (
            <div
              style={{
                gridColumn: "1 / -1",
                padding: "10px 12px",
                borderRadius: 18,
                background: "rgba(16, 185, 129, 0.08)",
                color: "var(--text-color)"
              }}
            >
              selected tenant: <strong>{selectedWhatsAppTenant.tenantSlug}</strong> | requested bot:{" "}
              <strong>{selectedWhatsAppTenant.desiredWhatsappBotE164 ?? "n/a"}</strong> | operator:{" "}
              <strong>{selectedWhatsAppTenant.operatorWhatsappE164 ?? "n/a"}</strong> | setup:{" "}
              <strong>{selectedWhatsAppTenant.whatsappSetup.status}</strong>
            </div>
          ) : null}
          <label>
            Phone Number ID
            <input
              value={whatsAppDraft.externalEndpointId}
              onChange={(event) =>
                setWhatsAppDraft((prev) => ({ ...prev, externalEndpointId: event.target.value }))
              }
            />
          </label>
          <label>
            Display phone
            <input
              value={whatsAppDraft.displayPhoneNumber}
              onChange={(event) =>
                setWhatsAppDraft((prev) => ({ ...prev, displayPhoneNumber: event.target.value }))
              }
            />
          </label>
          <label>
            E.164
            <input
              value={whatsAppDraft.e164}
              onChange={(event) =>
                setWhatsAppDraft((prev) => ({ ...prev, e164: event.target.value }))
              }
            />
          </label>
          <label>
            Display name
            <input
              value={whatsAppDraft.displayName}
              onChange={(event) =>
                setWhatsAppDraft((prev) => ({ ...prev, displayName: event.target.value }))
              }
            />
          </label>
          <label>
            Verified name
            <input
              value={whatsAppDraft.verifiedName}
              onChange={(event) =>
                setWhatsAppDraft((prev) => ({ ...prev, verifiedName: event.target.value }))
              }
            />
          </label>
          <label>
            WABA ID
            <input
              value={whatsAppDraft.wabaId}
              onChange={(event) =>
                setWhatsAppDraft((prev) => ({ ...prev, wabaId: event.target.value }))
              }
            />
          </label>
          <label>
            Business ID
            <input
              value={whatsAppDraft.businessId}
              onChange={(event) =>
                setWhatsAppDraft((prev) => ({ ...prev, businessId: event.target.value }))
              }
            />
          </label>
          <label>
            Environment
            <select
              value={whatsAppDraft.environment}
              onChange={(event) =>
                setWhatsAppDraft((prev) => ({
                  ...prev,
                  environment: event.target.value as WhatsAppEndpointDraft["environment"]
                }))
              }
            >
              <option value="production">production</option>
              <option value="sandbox">sandbox</option>
            </select>
          </label>
          <label>
            Binding status
            <select
              value={whatsAppDraft.bindingStatus}
              onChange={(event) =>
                setWhatsAppDraft((prev) => ({
                  ...prev,
                  bindingStatus: event.target.value as WhatsAppEndpointDraft["bindingStatus"]
                }))
              }
            >
              <option value="draft">draft</option>
              <option value="pending_verification">pending_verification</option>
              <option value="connected">connected</option>
              <option value="disabled">disabled</option>
            </select>
          </label>
          <label>
            Token source
            <select
              value={whatsAppDraft.tokenSource}
              onChange={(event) =>
                setWhatsAppDraft((prev) => ({
                  ...prev,
                  tokenSource: event.target.value as WhatsAppEndpointDraft["tokenSource"]
                }))
              }
            >
              <option value="unknown">unknown</option>
              <option value="map">map</option>
              <option value="fallback">fallback</option>
            </select>
          </label>
          <label>
            Template status
            <select
              value={whatsAppDraft.templateStatus}
              onChange={(event) =>
                setWhatsAppDraft((prev) => ({
                  ...prev,
                  templateStatus: event.target.value as WhatsAppEndpointDraft["templateStatus"]
                }))
              }
            >
              <option value="unknown">unknown</option>
              <option value="not_ready">not_ready</option>
              <option value="ready">ready</option>
            </select>
          </label>
          <label>
            Profile status
            <select
              value={whatsAppDraft.profileStatus}
              onChange={(event) =>
                setWhatsAppDraft((prev) => ({
                  ...prev,
                  profileStatus: event.target.value as WhatsAppEndpointDraft["profileStatus"]
                }))
              }
            >
              <option value="unknown">unknown</option>
              <option value="incomplete">incomplete</option>
              <option value="ready">ready</option>
            </select>
          </label>
          <label>
            Quality rating
            <input
              value={whatsAppDraft.qualityRating}
              onChange={(event) =>
                setWhatsAppDraft((prev) => ({ ...prev, qualityRating: event.target.value }))
              }
            />
          </label>
          <label>
            Meta status
            <input
              value={whatsAppDraft.metaStatus}
              onChange={(event) =>
                setWhatsAppDraft((prev) => ({ ...prev, metaStatus: event.target.value }))
              }
            />
          </label>
          <label>
            Code verification
            <input
              value={whatsAppDraft.codeVerificationStatus}
              onChange={(event) =>
                setWhatsAppDraft((prev) => ({
                  ...prev,
                  codeVerificationStatus: event.target.value
                }))
              }
            />
          </label>
        </div>
        <label style={{ display: "block", marginTop: 8 }}>
          Notes
          <textarea
            rows={4}
            value={whatsAppDraft.notes}
            onChange={(event) =>
              setWhatsAppDraft((prev) => ({ ...prev, notes: event.target.value }))
            }
            style={{ width: "100%" }}
          />
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
          <input
            type="checkbox"
            checked={whatsAppDraft.isActive}
            onChange={(event) =>
              setWhatsAppDraft((prev) => ({ ...prev, isActive: event.target.checked }))
            }
          />
          active endpoint
        </label>
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <button
            className="btn btn-ghost"
            onClick={() => {
              setWhatsAppDraft(EMPTY_WHATSAPP_ENDPOINT_DRAFT);
            }}
          >
            New Draft
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => {
              if (!selectedWhatsAppTenant) {
                setStatus("Select tenant first");
                return;
              }
              prefillWhatsAppDraftFromTenant(selectedWhatsAppTenant);
            }}
          >
            Prefill From Tenant
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              if (!whatsAppDraft.tenantId.trim() || !whatsAppDraft.externalEndpointId.trim()) {
                setStatus("Tenant and Phone Number ID are required");
                return;
              }
              const path = whatsAppDraft.id
                ? `/api/v1/super-admin/whatsapp/endpoints/${whatsAppDraft.id}`
                : "/api/v1/super-admin/whatsapp/endpoints";
              const method = whatsAppDraft.id ? "PUT" : "POST";
              void superAdminRequest<WhatsAppEndpoint>(path, {
                method,
                body: JSON.stringify({
                  tenantId: whatsAppDraft.tenantId.trim(),
                  externalEndpointId: whatsAppDraft.externalEndpointId.trim(),
                  environment: whatsAppDraft.environment,
                  bindingStatus: whatsAppDraft.bindingStatus,
                  displayName: whatsAppDraft.displayName,
                  displayPhoneNumber: whatsAppDraft.displayPhoneNumber,
                  e164: whatsAppDraft.e164,
                  verifiedName: whatsAppDraft.verifiedName,
                  wabaId: whatsAppDraft.wabaId,
                  businessId: whatsAppDraft.businessId,
                  tokenSource: whatsAppDraft.tokenSource,
                  templateStatus: whatsAppDraft.templateStatus,
                  profileStatus: whatsAppDraft.profileStatus,
                  qualityRating: whatsAppDraft.qualityRating,
                  metaStatus: whatsAppDraft.metaStatus,
                  codeVerificationStatus: whatsAppDraft.codeVerificationStatus,
                  notes: whatsAppDraft.notes,
                  isActive: whatsAppDraft.isActive,
                  actor
                })
              }).then(async (result) => {
                if (!result.ok) {
                  setStatus(result.error?.message ?? "WhatsApp endpoint save failed");
                  return;
                }
                setStatus(whatsAppDraft.id ? "WhatsApp endpoint updated" : "WhatsApp endpoint created");
                setWhatsAppDraft(EMPTY_WHATSAPP_ENDPOINT_DRAFT);
                await loadAll();
              });
            }}
          >
            Save Endpoint
          </button>
        </div>
        <div style={{ marginTop: 12 }}>
          {whatsAppEndpoints.length === 0 ? <p>No WhatsApp numbers registered yet.</p> : null}
          {whatsAppEndpoints.map((item) => (
            <div key={item.id} style={{ borderTop: "1px solid var(--border-color)", paddingTop: 8, marginTop: 8 }}>
              <p style={{ margin: 0 }}>
                <strong>{item.displayPhoneNumber ?? item.e164 ?? item.externalEndpointId}</strong> | {item.tenantSlug} |{" "}
                {item.bindingStatus} | token: {item.tokenSourceResolved} / {item.tokenHealthStatus}
                {item.tokenHealthHttpStatus ? ` (${item.tokenHealthHttpStatus})` : ""}
              </p>
              <p style={{ margin: "4px 0" }}>
                phone_number_id: {item.externalEndpointId} | verified: {item.verifiedName ?? "-"} | env:{" "}
                {item.environment} | templates: {item.templateStatus} | profile: {item.profileStatus}
              </p>
              <p style={{ margin: "4px 0" }}>
                WABA: {item.wabaId ?? "-"} | business: {item.businessId ?? "-"} | quality: {item.qualityRating ?? "-"} | meta:{" "}
                {item.metaStatus ?? "-"}
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="btn btn-ghost" onClick={() => loadWhatsAppDraft(item)}>
                  Edit
                </button>
              </div>
            </div>
          ))}
        </div>
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
